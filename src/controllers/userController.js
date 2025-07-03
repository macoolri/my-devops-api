import passport from 'passport'

import User from '../models/user'
import Base from './baseController'

export default class UserController extends Base {
    model = User

    signin = (req, res, next) => {
        return passport.authenticate('local', { session: false }, (err, passportUser, info) => {
            if (err) {
                console.log('Erro')
                console.log(err)
                return next(err)
            }

            if (passportUser) {
                const user = passportUser
                user.token = passportUser.generateJWT()

                return res.json({ user: user.toAuthJSON() })
            }

            res.status(400).json({ error: { message: info } })
        })(req, res, next)
    }

    signup = async (req, res) => {
        const obj = new this.model(req.body)
        obj.setPassword(req.body.password)

        try {
            const doc = await obj.save()
            res.json({ user: obj.toAuthJSON() })
        } catch (err) {
            if (err.code === 11000 || (err.message && err.message.indexOf('duplicate key error') !== -1)) {
                const customError = new Error('Email already exists');
                customError.name = 'DuplicateKeyError';
                return this._respondError(res, customError, 'signup');
            }
            return this._respondError(res, err, 'signup')
        }
    }
}