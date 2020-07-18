'use strict';

(function (exports) {
    const Type = Object.freeze({
        Sync: 0,
        SyncAck: 1,
        Data: 2,
        Fin: 3
    });

    class Message {
        static get Type() {
            return Type;
        };

        constructor(config) {
            this._type = 0;
            this._mode = 0;
            this._size = 0;
            this._count = 0;
            this._interval = 16;
            this._seqNum = 0;

            if (config) {
                if (Object.prototype.hasOwnProperty.call(config, 'type')) {
                    this._type = config.type
                }
                if (Object.prototype.hasOwnProperty.call(config, 'mode')) {
                    this._mode = config.mode
                }
                if (Object.prototype.hasOwnProperty.call(config, 'size')) {
                    this._size = config.size
                }
                if (Object.prototype.hasOwnProperty.call(config, 'count')) {
                    this._count = config.count
                }
                if (Object.prototype.hasOwnProperty.call(config, 'interval')) {
                    this._interval = config.interval
                }
                if (Object.prototype.hasOwnProperty.call(config, 'seqNum')) {
                    this._seqNum = config.seqNum
                }
            }
        }

        get type() {
            return this._type;
        }
        get mode() {
            return this._mode;
        }
        get size() {
            return this._size;
        }
        get count() {
            return this._count;
        }
        get interval() {
            return this._interval;
        }
        get seqNum() {
            return this._seqNum;
        }
        get padding() {
            return this._padding;
        }

        marshal() {
            let bufLen = 8;
            if (this._type === Type.Data) {
                bufLen = this._size;
            }
            const buf = new ArrayBuffer(bufLen);
            const view = new DataView(buf);

            view.setUint8(0, this._type);
            view.setUint8(1, this._mode);
            view.setUint16(2, this._size);
            view.setUint16(4, this._count);
            view.setUint16(6, this._interval);

            if (this._type === Type.Data) {
                view.setUint32(8, this._seqNum);
            }

            return buf;
        }

        unmarshal(buf) {
            if (!buf || buf.byteLength < 8) {
                throw new Error("data too short");
            }
            const view = new DataView(buf);

            this._type = view.getUint8(0);
            this._mode = view.getUint8(1);
            this._size = view.getUint16(2);
            this._count = view.getUint16(4);
            this._interval = view.getUint16(6);

            if (this._type === Type.Data) {
                this._seqNum = view.getUint32(8);
                this._padding = buf.slice(8);
            }
        }
    }

    exports.Message = Message;

})(typeof exports === 'undefined' ? this : exports);