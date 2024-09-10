const AWS = require('aws-sdk');
const nodemailer = require('nodemailer');
const { logText } = require('./logger');

//So SES is the best we got, everything else is quick to block ya - so just use amazon.

class emailer {
    constructor(config, max_per_timeframe, timeframe_ms, ratelimiter_modifier = 5) {
        if (!config.enabled || !config) return;

        this.max_per_timeframe = max_per_timeframe;
        this.timeframe_ms = timeframe_ms;

        this.config = config;
        
        AWS.config.update(this.config);

        this.transporter = nodemailer.createTransport({
            SES: new AWS.SES()
        });

        this.ratelimited = false;
        this.ratelimitedWhen = null;
        this.sentRLNotice = false;
        this.outNumberPerTF = 0;
        this.ratelimiter_modifier = ratelimiter_modifier;

        this.ratelimiter = setInterval(() => {
            if (this.ratelimited && this.ratelimitedWhen != null) {
                this.ratelimited = (Date.now() - this.ratelimitedWhen) >= (this.timeframe_ms * this.ratelimiter_modifier);
                this.ratelimitedWhen = !this.ratelimited ? null : this.ratelimitedWhen;
                this.outNumberPerTF = !this.ratelimited ? 0 : this.outNumberPerTF;

                if (!this.ratelimited) {
                    logText('Out of configured ratelimit. Able to send e-mails again.', 'EMAILER');

                    this.sentRLNotice = false;
                }
            }

            this.ratelimited = this.outNumberPerTF > max_per_timeframe && !this.ratelimited;

            if (this.ratelimited && !this.sentRLNotice) {
                logText(`Hit configured e-mail ratelimit - Will be able to send e-mails again in ~${Math.round(this.timeframe_ms * this.ratelimiter_modifier)}ms.`);
                
                this.sentRLNotice = true;
            }
        }, this.timeframe_ms);
    }
    async trySendEmail(to, subject, content) {
        try {
            if (this.ratelimited) return false;

            if (!this.config.enabled || !this.config || !this.transporter) return false;
    
            let mailOptions = {
                from: this.config.fromAddress, 
                to: to,
                subject: subject,
                html: content
            };

            const result = await new Promise((resolve) => {
                this.transporter.sendMail(mailOptions, (error, info) => {
                    resolve(!error);
                });
            });
    
            return result;
        } catch (error) {
            logText(error, "error");

            return false;
        }
    }
}

module.exports = emailer;