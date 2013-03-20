/**
 * Copyright 2013 Calvin 'calzoneman' Montgomery
 *
 * Licensed under Creative Commons Attribution-NonCommercial 3.0
 * See http://creativecommons.org/licenses/by-nc/3.0/
 *
 */

var Config = require('./config.js');
var connect = require('connect');
var app = connect.createServer(connect.static(__dirname+'/www')).listen(Config.IO_PORT);
exports.io = require('socket.io').listen(app);
var User = require('./user.js').User;
var Database = require('./database.js');
Database.init();

exports.channels = {};

exports.io.sockets.on('connection', function(socket) {
    var user = new User(socket, socket.handshake.address.address);
    console.log('New connection from /' + user.ip);
});
