'use strict';
/*eslint no-console: 0*/

(function (exports) {

const State = Object.freeze({
    Closed: 0,
    Connecting: 1,
    Ready: 2,
    Draining: 3,
});

const Mode = Object.freeze({
    Upload: 0,
    Download: 1,
    Loopback: 2
});

const deepCopy = (srcObj) => {
    return JSON.parse(JSON.stringify(srcObj));
};

class Endpoint {
    static get State() {
        return State;

    }

    static get Mode() {
        return Mode;

    }

    constructor(config) {
        this.config = config;
        this.serverName = config.serverName;
        this.username = config.username;
        this.password = config.password;
        this.transport = config.transport;
        this.mode = config.mode;
        this.msgSize = config.msgSize;
        this.numMsgs = config.numMsgs;
        this.interval = config.interval;
        this.ordered = config.ordered;
        this.maxRetransmits = config.maxRetransmits;
        this.maxPacketLifeTime = config.maxPacketLifeTime;
        this.seqNum = 0;
        this.totalBytesReceived = 0;
        this.transferStartedAt = 0
        this.sessId = null;
        this.dc = null;
        this.state = State.Closed;
        this.sendTimer = null;
       this.ondescription = null;
    }

    get name() {
        return this.isInitiator? 'ep0' : 'ep1';
    }

    close() {
        if (this.sendTimer) {
            clearInterval(this.sendTimer);
            this.sendTimer = null;
        }
        if (this.statsTimer) {
            clearInterval(this.statsTimer);
            this.statsTimer = null;
        }
        if (this.dc) {
            this.dc.close();
        }
        if (this.pc) {
            this.pc.close();
        }
    }

    start() {
        this.isInitiator = true;
        this.createNewConnection();

        // const opts = null
        const opts = {};
        if (this.ordered > 0) {
            switch (this.ordered) {
            case 1:
                opts.ordered = true;
                break;
            case 2:
                opts.ordered = false;
            }
        }

        if (this.maxRetransmits >= 0) {
            opts.maxRetransmits = this.maxRetransmits;
        } else if (this.maxPacketLifeTime >= 0) {
            opts.maxPacketLifeTime = this.maxPacketLifeTime;
        }
        console.log(`[${this.name}] reliability option: ${opts}`);

        this.dc = this.pc.createDataChannel('data', opts)
        this.setUpDataChannel();

        console.log(`[${this.name}] createOffer start`);
        this.pc.createOffer().then((desc) => {
            this.onCreateOfferSuccess(desc);
        }, (err) => {
            console.log(`[${this.name}] createOffer failed:`, err);
        });
    }

    onSendTick() {
        if (this.state === State.Ready) {
            if (this.mode !== Mode.Download) {
                console.log(`[${this.name}] sending ${this.msgSize} bytes (seqNum=${this.seqNum} of ${this.numMsgs})`);
                let smsg = new Message({
                    type: Message.Type.Data,
                    size: this.msgSize,
                    seqNum: this.seqNum,
                });
                let bytes = smsg.marshal();
                this.dc.send(bytes);

                this.seqNum++

                if (this.seqNum === this.numMsgs) {
                    this.state = State.Draining;
                }
            }
        } else if (this.state === State.Draining) {
            if (this.mode !== Mode.Download) {
                if (this.dc.bufferedAmount === 0) {
                    const smsg = new Message({
                        type: Message.Type.Fin,
                    });
                    const bytes = smsg.marshal();
                    this.dc.send(bytes);
                    this.state = State.Closed;
                    setTimeout(() => {
                        this.dc.close();
                        this.pc.close();
                        if (this.onclose) {
                            this.onclose();
                        }
                    }, 100);
                }
            }
        }
    }

    onMessage(rmsg) {
        if (rmsg.type === Message.Type.Sync) {
            console.log(`[${this.name}] received Sync`);
            console.dir(rmsg);
            switch (rmsg.mode) {
            case Mode.Upload:
                this.mode = Mode.Download;
                break;
            case Mode.Download:
                this.mode = Mode.Upload;
                break;
            default:
                this.mode = rmsg.mode;
            }
            this.msgSize = rmsg.size;
            this.numMsgs = rmsg.count;
            this.interval = rmsg.interval;
            const smsg = new Message({
                type: Message.Type.SyncAck,
                mode: this.mode,
                size: this.msgSize,
                count: this.numMsgs,
                interval: this.interval,
            });
            const bytes = smsg.marshal();
            this.dc.send(bytes);
            this.state = State.Ready;
            if (!this.sendTimer) {
                console.log(`[${this.name}]setInterval: %d`, this.interval);
                this.sendTimer = setInterval(this.onSendTick.bind(this), this.interval);
            }
        } else if (rmsg.type === Message.Type.SyncAck) {
            console.log(`[${this.name}] received SyncAck`);
            console.dir(rmsg);
            this.state = State.Ready;
            if (!this.sendTimer) {
                console.log(`[${this.name}]setInterval: %d`, this.interval);
                this.sendTimer = setInterval(this.onSendTick.bind(this), this.interval);
            }
        } else if (rmsg.type === Message.Type.Data) {
            const dataLen = rmsg.padding.byteLength + 8;
            this.totalBytesReceived += dataLen;
            const throughput = (this.totalBytesReceived * 8) / ((Date.now() - this.transferStartedAt) / 1000) / 1024 / 1024;
            console.log(`[${this.name}] received ${dataLen} bytes (seqNum=${rmsg.seqNum} throughput=${throughput})`)
        } else if (rmsg.type === Message.Type.Fin) {
            console.log(`[${this.name}] received Fin`);
            setTimeout(() => {
                this.dc.close();
                this.pc.close();
                if (this.onclose) {
                    this.onclose();
                }
            }, 100);
        }
    }

    createNewConnection() {
        console.log(`[${this.name}] Starting creating peer connection`);
        const config = {
            iceServers: [{
                urls: [`turn:${this.serverName}?transport=${this.transport}`],
                username: this.username,
                credential: this.password
            }],
            iceTransportPolicy: 'relay'
        };
        console.log(`[${this.name}] turn server uri: %s`, config.iceServers[0].urls[0]);

        this.pc = new RTCPeerConnection(config);
        console.log(`[${this.name}] created local peer connection object this.pc`);
        this.pc.onicecandidate = (e) => this.onIceCandidate(e);
        this.pc.oniceconnectionstatechange = (e) => {
            console.log(`[${this.name}] ice connecton state: %s`, this.pc.iceConnectionState);
        };
        this.pc.onsignalingstatechange = (e) => {
            console.log(`[${this.name}] signaling state: %s`, this.pc.signalingState);
        };
        /*
        if (!this.statsTimer) {
            this.statsTimer = setInterval(() => {
                this.onStatTick();
            }, 2000);
        }
        */
    }

    /*
    onStatTick() {
        this.pc.getStats(res => {
            res.result().forEach(result => {
                var item = {};
                result.names().forEach(name => {
                    item[name] = result.stat(name);
                });
                item.id = result.id;
                item.type = result.type;
                item.timestamp = result.timestamp;
                console.log("stitem:", item);
            });
        });
    }
    */

    setUpDataChannel() {
        this.dc.binaryType = "arraybuffer";
        this.dc.onclose = () => {
            console.log(`[${this.name}] dc has closed`)
            this.pc.close();
            if (this.onclose) {
                this.onclose();
            }
        }
        this.dc.onopen = () => {
            console.log(`[${this.name}] dc has opened`)
            this.seqNum = 0;
            this.totalBytesReceived = 0;
            this.transferStartedAt = Date.now();
            if (this.isInitiator) {
                const smsg = new Message({
                    type: Message.Type.Sync,
                    mode: this.mode,
                    size: this.msgSize,
                    count: this.numMsgs,
                    interval: this.interval,
                });
                const bytes = smsg.marshal();
                console.log(`[${this.name}] sending Sync`);
                this.dc.send(bytes);
                this.state = State.Connecting;
            }
        }
        this.dc.onmessage = e => {
            const rmsg = new Message();
            rmsg.unmarshal(e.data);
            this.onMessage(rmsg);
        }
    }

    handleDescription(desc) {
        console.log(`[${this.name}] received %s`, desc.type);
        console.dir(desc);

        if (!this.pc) {
            this.createNewConnection();
            this.pc.ondatachannel = (ev) => {
                console.log(`[${this.name}] new data channel`);
                this.dc = ev.channel;
                this.setUpDataChannel();
            };
        }

        this.pc.setRemoteDescription(desc, () => {
            console.log(`[${this.name}] setRemoteDescription complete`);
        }, (err) => {
            console.log(`[${this.name}] setRemoteDescription failed:`, err);
        });

        if (!this.isInitiator) {
            console.log(`[${this.name}] createAnswer start`);
            this.pc.createAnswer().then((desc) => {
                this.onCreateAnswerSuccess(desc);
            }, (err) => {
                console.log(`[${this.name}] createAnswer failed:`, err);
            });
        }
    }

    onCreateOfferSuccess(desc) {
        const sDesc = JSON.stringify(desc);
        console.log(`[${this.name}] created offer: ${sDesc}`);
        console.log(`[${this.name}] setLocalDescription start`);
        this.pc.setLocalDescription(desc, () => {
            console.log(`[${this.name}] setLocalDescription complete`);
        }, (err) => {
            console.log(`[${this.name}] setLocalDescription failed:`, err);
        });
    }

    onCreateAnswerSuccess(desc) {
        const sDesc = JSON.stringify(desc);
        console.log(`[${this.name}] created answer: ${sDesc}`);
        console.log(`[${this.name}] setLocalDescription start`);
        this.pc.setLocalDescription(desc, () => {
            console.log(`[${this.name}] answerer: setLocalDescription complete`);
        }, (err) => {
            console.log(`[${this.name}] answerer: setLocalDescription failed:`, err);
        });
    }

    onIceCandidate(event) {
        if (event.candidate) {
            console.log(`[${this.name}] collecting ICE candidate:`, event.candidate);
        } else {
            console.log(`[${this.name}] end of ICE candidate`);
            if (this.ondescription) {
                const desc = deepCopy(this.pc.localDescription);
                this.ondescription(desc)
            }
        }
    }
}

exports.Endpoint = Endpoint;

})(typeof exports === 'undefined' ? this : exports);