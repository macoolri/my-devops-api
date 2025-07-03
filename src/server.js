import express from 'express';
import mongoose from 'mongoose';
import { register, httpRequestCounter, httpRequestDurationMicroseconds } from './utils/metrics';
import cors from 'cors';
import passport from 'passport';
import fetch from 'node-fetch';
import snappy from 'snappy';

import setRoutes from './routes';
import usePassport from './passport';
import config from './config';

// Initial Setting

usePassport();

// Express

const app = express();

app.set('port', config.PORT);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(passport.initialize());

// Middleware для сбора метрик HTTP-запросов
app.use((req, res, next) => {
    const end = httpRequestDurationMicroseconds.startTimer();
    res.on('finish', () => {
        const route = req.route ? req.route.path : req.path;
        httpRequestCounter.inc({
            method: req.method,
            route: route,
            status_code: res.statusCode,
        });
        end({
            method: req.method,
            route: route,
            status_code: res.statusCode,
        });
    });
    next();
});

// Mongoose

mongoose.Promise = global.Promise;
mongoose.set('debug', config.MONGODB_DEBUG);
mongoose
    .connect(
        config.MONGODB_URI,
        {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        }
    )
    .then(() => {
        if (process.env.NODE_ENV !== 'test') {
            console.log('Connected to MongoDB', config.MONGODB_URI);
        }

        setRoutes(app);

        if (!module.parent) {
            const port = process.env.PORT || config.PORT;

            const GRAFANA_CLOUD_PROMETHEUS_URL = 'https://prometheus-prod-39-prod-eu-north-0.grafana.net/api/prom/push';

            const GRAFANA_CLOUD_USERNAME = process.env.GRAFANA_CLOUD_USERNAME;
            const GRAFANA_CLOUD_PASSWORD = process.env.GRAFANA_CLOUD_PASSWORD;

            if (!GRAFANA_CLOUD_USERNAME || !GRAFANA_CLOUD_PASSWORD) {
                console.warn('WARNING: GRAFANA_CLOUD_USERNAME or GRAFANA_CLOUD_PASSWORD environment variables are missing. Metrics push will fail.');
            }

            // Функция для отправки метрик напрямую в Grafana Cloud
            const pushMetricsToGrafanaCloud = async () => {
                try {
                    const metrics = await register.metrics();
                    const headers = {
                        'Content-Type': 'application/x-protobuf',
                        'Content-Encoding': 'snappy'
                    };

                    if (GRAFANA_CLOUD_USERNAME && GRAFANA_CLOUD_PASSWORD) {
                        const credentials = Buffer.from(`${GRAFANA_CLOUD_USERNAME}:${GRAFANA_CLOUD_PASSWORD}`).toString('base64');
                        headers['Authorization'] = `Basic ${credentials}`;
                    }

                    const snappiedMetrics = await snappy.compress(Buffer.from(metrics));

                    const response = await fetch(GRAFANA_CLOUD_PROMETHEUS_URL, {
                        method: 'POST',
                        headers: headers,
                        body: snappiedMetrics
                    });

                    if (!response.ok) {
                        console.error(`Failed to push metrics to Grafana Cloud: ${response.status} ${response.statusText} - Response: ${await response.text()}`);
                    } else {
                        console.log('Metrics successfully pushed to Grafana Cloud.');
                    }
                } catch (error) {
                    console.error('Error pushing metrics to Grafana Cloud:', error);
                }
            };

            setInterval(pushMetricsToGrafanaCloud, 15 * 1000);
            pushMetricsToGrafanaCloud();

            app.listen(port, () => console.log(`Listening on port ${port}`));
        }
    })
    .catch(err => console.error(err));