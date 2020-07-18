'use strict';

class App {
  constructor(config) {
    this.config = Object.assign({}, config);
    this.state = {};
    this.ep0 = null;
    this.ep1 = null;
  }

  get isStarted() {
    return !!this.ep0;
  }

  createNewEndpoint() {
    let mode;
    switch (this.state.mode) {
        case 'upload':
            mode = Endpoint.Mode.Upload;
            break;
        case 'download':
            mode = Endpoint.Mode.Download;
            break;
        case 'loopback':
            mode = Endpoint.Mode.Loopback;
            break;
        default:
            throw new Error(`invalid mode: ${this.state.mode}`);
    }

    return new Endpoint({
      config: this.config,
      serverName: this.state.serverName,
      username: this.state.username,
      password: this.state.password,
      mode: mode,
      msgSize: this.state.msgSize,
      numMsgs: this.state.numMsgs,
      interval: this.state.interval,
      ordered: this.state.ordered,
      maxRetransmits: this.state.maxRetransmits,
      maxPacketLifeTime: this.state.maxPacketLifeTime,
    });
  }

  start() {
    this.ep0 = this.ep1 = null;
    this.ep0 = this.createNewEndpoint();
    this.ep0.ondescription = (desc) => {
      if (!this.ep1) {
        this.ep1 = this.createNewEndpoint();
        this.ep1.ondescription = (desc) => {
          if (this.ep0) {
            this.ep0.handleDescription(desc);
          }
        };
        this.ep1.onclose = () => {
          delete this.ep1;
          if (this.ep0) {
            this.ep0.close();
            delete this.ep0;
            if (this.onstop) {
              this.onstop();
            }
          }
        };
      }
      this.ep1.handleDescription(desc);
    };
    this.ep0.onclose = () => {
      delete this.ep0;
      if (this.ep1) {
        this.ep1.close();
        delete this.ep1;
      }
      if (this.onstop) {
        this.onstop();
      }
    };

    try {
      this.ep0.start();
    } catch (e) {
      delete this.ep0;
      throw e;
    }
  }

  stop() {
    if (this.ep0) {
      this.ep0.close();
      delete this.ep0;
    }
    if (this.ep1) {
      this.ep1.close();
      delete this.ep1;
    }
  }
}