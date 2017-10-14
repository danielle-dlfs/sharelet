'use strict';

exports.app = {
    secret : process.env.SECRET
};

exports.database = {
    contactPoints : ['192.168.2.5', '192.168.2.6', '192.168.2.7'],
    keyspace: 'sharelet',
    username : 'cassandra',
    password : 'cassandra'
};

exports.server = {
    port: '3000'
};