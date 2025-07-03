import express from 'express';
import mongoose from 'mongoose';
import { register, httpRequestCounter, httpRequestDurationMicroseconds } from './utils/metrics';
import cors from 'cors';
import passport from 'passport';

import net from 'net';

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
    .connect(config.MONGODB_URI, {})
    .then(() => {
        if (process.env.NODE_ENV !== 'test') {
            console.log('Connected to MongoDB', config.MONGODB_URI);
        }

        setRoutes(app);

        if (!module.parent) {
            const port = process.env.PORT || config.PORT;

            const GRAPHITE_HOST = process.env.GRAFANA_CLOUD_GRAPHITE_HOST;
            const GRAPHITE_PORT = parseInt(process.env.GRAFANA_CLOUD_GRAPHITE_PORT || '2003', 10);
            const GRAPHITE_USERNAME = process.env.GRAFANA_CLOUD_USERNAME;
            const GRAPHITE_API_KEY = process.env.GRAFANA_CLOUD_API_KEY;

            if (!GRAPHITE_HOST || !GRAPHITE_USERNAME || !GRAPHITE_API_KEY) {
                console.warn('WARNING: Grafana Cloud Graphite credentials are missing. Metrics will not be pushed.');
            } else {
                const sendMetricToGraphite = (metricLine) => {
                    const client = new net.Socket();
                    client.connect(GRAPHITE_PORT, GRAPHITE_HOST, () => {
                        const authString = `${GRAPHITE_USERNAME} ${GRAPHITE_API_KEY}\n`;
                        client.write(authString + metricLine + '\n');
                        client.end();
                    });

                    client.on('error', (err) => {
                        console.error('Graphite TCP Error:', err.message);
                    });

                    client.on('close', () => {
                        console.log('Graphite connection closed.');
                    });
                };


                // Функция для сбора и отправки всех метрик
                const pushMetricsToGraphite = async () => {
                    try {
                        const promMetrics = await register.metrics();
                        const lines = promMetrics.split('\n');
                        const timestamp = Math.floor(Date.now() / 1000);

                        const prefix = 'node_app.';

                        for (const line of lines) {
                            if (line.startsWith('#') || line.trim() === '') {
                                continue;
                            }

                            const parts = line.split(' ');
                            if (parts.length < 2) continue;

                            let metricNameWithLabels = parts[0];
                            const value = parseFloat(parts[1]);

                            let metricName = metricNameWithLabels.split('{')[0];
                            
                            if (metricNameWithLabels.includes('{')) {
                                const labelsPart = metricNameWithLabels.substring(
                                    metricNameWithLabels.indexOf('{') + 1,
                                    metricNameWithLabels.indexOf('}')
                                );
                                labelsPart.split(',').forEach(label => {
                                    const [key, val] = label.split('=');
                                    if (key && val) {
                                        const cleanKey = key.replace(/[^a-zA-Z0-9_]/g, '_');
                                        const cleanVal = val.replace(/"/g, '').replace(/[^a-zA-Z0-9_\-.]/g, '_');
                                        metricName += `.${cleanKey}_${cleanVal}`;
                                    }
                                });
                            }

                            if (!isNaN(value)) {
                                const fullMetricName = `${prefix}${metricName}`;
                                const metricLine = `${fullMetricName} ${value} ${timestamp}`;

                                sendMetricToGraphite(metricLine);
                            }
                        }
                        console.log('Attempted to send metrics to Graphite.');

                    } catch (error) {
                        console.error('Error pushing metrics to Graphite:', error);
                    }
                };

                setInterval(pushMetricsToGraphite, 15 * 1000);
                pushMetricsToGraphite();
            }

            app.get('/metrics', async (req, res) => {
                res.set('Content-Type', register.contentType);
                res.end(await register.metrics());
            });

            app.listen(port, () => console.log(`Listening on port ${port}`));
        }
    })
    .catch(err => console.error(err));

export default app;