'use strict';

exports.app = {
    secret : 'TEST-SECRET',
    salt : 'auth-sharelet',
};

exports.database = {
    contactPoints : ['127.0.O.1'],
    keyspace: 'sharelet',
    username : 'cassandra',
    password : 'cassandra'
};

exports.ws = {
    appEndpoint : '192.168.2.8'
};

exports.server = {
    port: '80'
};
