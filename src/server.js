import express from 'express'
import mongoose from 'mongoose'
import { register, httpRequestCounter, httpRequestDurationMicroseconds } from './utils/metrics';
import cors from 'cors'
import passport from 'passport'

import setRoutes from './routes'
import usePassport from './passport'
import config from './config'

// Initial Setting

mongoose.set('useFindAndModify', false)
usePassport()

// Express

const app = express()

app.set('port', config.PORT)

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true, limit: '100kb' }))
app.use(passport.initialize())

// Middleware для сбора метрик HTTP-запросов
app.use((req, res, next) => {
    if (req.path === '/metrics') {
        return next();
    }

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

mongoose.Promise = global.Promise
mongoose.set('debug', config.MONGODB_DEBUG)
mongoose
    .connect(
        config.MONGODB_URI,
        { useNewUrlParser: true }
    )
    .then(() => {
        if (process.env.NODE_ENV !== 'test') {
            console.log('Connected to MongoDB', config.MONGODB_URI)
        }

        setRoutes(app)

        if (!module.parent) {
            const port = process.env.PORT || config.PORT;           
            const metricsUser = process.env.USER_FOR_METRICS;
            const metricsPass = process.env.PASS_FOR_METRICS;

            if (metricsUser && metricsPass) {
                const basicAuth = (req, res, next) => {
                    const authHeader = req.headers.authorization;
                    if (!authHeader) {
                        res.setHeader('WWW-Authenticate', 'Basic realm="Metrics"');
                        return res.status(401).send('Authentication required');
                    }

                    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
                    const [user, pass] = auth.split(':');

                    if (user === metricsUser && pass === metricsPass) {
                        return next();
                    } else {
                        res.setHeader('WWW-Authenticate', 'Basic realm="Metrics"');
                        return res.status(401).send('Authentication failed');
                    }
                };

                app.get('/metrics', basicAuth, async (req, res) => {
                    res.set('Content-Type', register.contentType);
                    res.end(await register.metrics());
                });
            } else {
                console.warn('Metrics endpoint is not protected with basic auth. USER_FOR_METRICS or PASS_FOR_METRICS environment variables are missing.');
                app.get('/metrics', async (req, res) => {
                    res.set('Content-Type', register.contentType);
                    res.end(await register.metrics());
                });
            }
            app.listen(port, () => console.log(`Listening on port ${port}`));
        }
    })
    .catch(err => console.error(err))

export default app
