'use strict';

/**
 * Module dependencies.
 * @private
 */

const cassandra = require('cassandra-driver');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const ws = require('ws');

const config = require('./config');

/*
 * Cassandra config
 */
const cass_auth = new cassandra.auth.PlainTextAuthProvider(
  config.database.username,
  config.database.password
);

const client = new cassandra.Client({
  contactPoints: config.database.contactPoints,
  keyspace: config.database.keyspace,
  authProvider : cass_auth
});

/*
 * Cassandra requests
 */
const INSERT_DATA_CQL = "INSERT INTO consumption_by_day (outlet_id, date, event_time, sensor_type, sensor_value) VALUES (?, ?, ?, ?, ?)";
const GET_SETTINGS_START = "SELECT * FROM outlets_alert WHERE outlet_id = '";
const GET_SETTINGS_END = "'";
const UPDATE_STATE_BEGIN = "UPDATE outlet_state SET state = ";
const UPDATE_STATE_MIDDLE = " WHERE outlet_id = '";
const UPDATE_STATE_END = "'";
const SELECT_MAIL_BEGIN = "SELECT email FROM users WHERE outlets CONTAINS '";
const SELECT_MAIL_END = "' ALLOW FILTERING";
/*
 * Nodemailer config
 */
const transporter = nodemailer.createTransport(
  config.smtp,
  {
    from : 'sharelet.noreply@gmail.com',
    subject: 'Alert'
  }
);

transporter.verify(error => {
  if(error) {
    console.log("Nodemailer config : ", error);
    process.exit(-1);
  }
});

/*
 * Websockets config
 */
const wsFromClients = new ws.Server(config.wsFromClients);
const wsFromAPI = new ws.Server(config.wsFromAPI);
let wsClients = {};

wsFromClients.on('connection', ws => {
  ws.on('message', message => {
    try {
      const outlet = JSON.parse(message);

      // Check password of the outlet
      const md5Hash = crypto.createHash('md5').update(outlet.outlet_id).digest('base64');
      const hash = crypto.createHash('sha256').update(config.app.salt + md5Hash + config.app.salt).digest('base64');

      if(hash === outlet.pwd) {
        if(!wsClients.hasOwnProperty(outlet.outlet_id) || wsClients[outlet.outlet_id] != ws) {
          wsClients[outlet.outlet_id] = ws;

          client.execute(GET_SETTINGS_START + outlet.outlet_id + GET_SETTINGS_END).then(res => {
            if(res.rows.length !== 0)
              wsClients[outlet.outlet_id].alerts = res.rows[0];
          });
        }

        const date = new Date(outlet.timestamp * 1000);
        const date_str = date.getDate() + '-' + date.getMonth() + '-' + date.getFullYear();

        for(let i in outlet.data) {
          client.execute(INSERT_DATA_CQL, [outlet.outlet_id, date_str, date, outlet.data[i].sensor_type, outlet.data[i].value], {prepare: true}).then(res => {
            ws.send(JSON.stringify({res : "OK"}));
          });

          let value = outlet.data[i].value;
          let alerts = wsClients[outlet.outlet_id].alerts;

          if(alerts && (value < alerts.low || value > alerts.high)) {
            client.execute(SELECT_MAIL_BEGIN + outlet.outlet_id + SELECT_MAIL_END).then((err, res) => {
              if(err){
                console.log("ERROR SELECT MAIL", err);
              }else if(res.rows.length > 0){
                let destination = res.rows[0].email;
                if(destination){
                  transporter.sendMail({
                    to: destination,
                    text: "Alert on "+outlet.outlet_id+" value " + value
                  }, error => {
                    if(error){
                      console.log("Sending mail error", error.message);
                    }
                  });
                }
              }
            });
          }
        }
      } else {
        ws.send(JSON.stringify({res : "NOK"}));
      }
    } catch(e) {
      console.log("ws Clients JSON : ", e.message);
      process.exit(-1);
    }
  });
});

wsFromAPI.on('connection', ws => {
  ws.on('message', message => {
    try {
      const data = JSON.parse(message);

      if(data.type === 0) {
        const connection = wsClients[data.target];

        if(typeof connection !== 'undefined') {
          connection.send(JSON.stringify({type : 0, close : data.power}));
          client.execute(UPDATE_STATE_BEGIN + data.power + UPDATE_STATE_MIDDLE + data.target + UPDATE_STATE_END, error => {
            if(error) {
              console.log("ws API cassandra : ", error);
              process.exit(-1);
            }
          });

          ws.send({"type" : 4, "ok" : true, "target" : data.target});
        } else {
          ws.send({"type" : 4, "ok" : false, "target" : data.target});
        }
      }
    } catch(e) {
      console.log("ws API JSON : " ,e.message);
      process.exit(-1);
    }
  });
});
