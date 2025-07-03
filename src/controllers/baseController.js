import { respond } from '../utils/utils'

export default class BaseContrroller {
    model

    _respondError = (res, err, endpoint = undefined, status = 442) => {
        const out = { error: { model: '', endpoint: '', message: '', type: '' } }

        out.error.message = err._message || err.message
        out.error.type = err.name
        out.error.model = this.model.collection.collectionName
        out.error.endpoint = endpoint || ''

        if (err.errors) out.error.errors = err.errors

        respond(res, status, out)
    }

    _respondOk = (res, data, status_code = 200) => {
        res.status(status_code).json({ status: 'OK', data: data })
    }

    get = async (req, res) => {
        try {
            const doc = await this.model.findOne({ _id: req.params.id })
            this._respondOk(res, doc)
        } catch (err) {
            this._respondError(res, err, 'get')
        }
    }

    all = async (req, res) => {
        try {
            const docs = await this.model.find({})
            this._respondOk(res, docs)
        } catch (err) {
            this._respondError(res, err, 'all')
        }
    }

    count = async (req, res) => {
        try {
            const count = await this.model.countDocuments({})
            res.status(200).json({ count: count, status: 'OK' })
        } catch (err) {
            this._respondError(res, err, 'count')
        }
    }

    store = async (req, res) => {
        try {
            const obj = new this.model(req.body)
            const doc = await obj.save()
            this._respondOk(res, doc)
        } catch (err) {
            if (err.code === 11000) {
                return res.status(409).json({
                    error: {
                        message: 'Duplicate key error. This record already exists.',
                        type: 'DuplicateKeyError',
                        model: this.model.collection.collectionName
                    }
                })
            }
            return this._respondError(res, err, 'store')
        }
    }

    update = async (req, res) => {
        try {
            const doc = await this.model.findOneAndUpdate({ _id: req.params.id }, req.body, { new: true })
            this._respondOk(res, doc)
        } catch (err) {
            this._respondError(res, err, 'update')
        }
    }

    delete = async (req, res) => {
        try {
            const doc = await this.model.findOneAndDelete({ _id: req.params.id })
            this._respondOk(res, doc)
        } catch (err) {
            this._respondError(res, err, 'delete')
        }
    }
}