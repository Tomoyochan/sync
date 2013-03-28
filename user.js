/*
The MIT License (MIT)
Copyright (c) 2013 Calvin Montgomery
 
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

var Rank = require("./rank.js");
var Auth = require("./auth.js");
var Channel = require("./channel.js").Channel;
var Server = require("./server.js");
var Database = require("./database.js");
var Logger = require("./logger.js");

// Represents a client connected via socket.io
var User = function(socket, ip) {
    this.ip = ip;
    this.socket = socket;
    this.loggedIn = false;
    this.rank = Rank.Guest;
    this.channel = null;
    this.playerReady = false;
    this.name = "";

    this.initCallbacks();
    if(Server.announcement != null) {
        this.socket.emit("announcement", Server.announcement);
    }
};


// Set up socket callbacks
User.prototype.initCallbacks = function() {
    // What a shame
    this.socket.on("disconnect", function() {
        if(this.channel != null)
            this.channel.userLeave(this);
    }.bind(this));

    this.socket.on("joinChannel", function(data) {
        if(data.name == undefined)
            return;
        if(!data.name.match(/^[a-zA-Z0-9]+$/))
            return;
        if(data.name.length > 100)
            return;
        // Channel already loaded
        if(data.name in Server.channels) {
            this.channel = Server.channels[data.name];
            this.channel.userJoin(this);
        }
        // Channel not loaded
        else {
            Server.channels[data.name] = new Channel(data.name);
            this.channel = Server.channels[data.name];
            this.channel.userJoin(this);
        }
    }.bind(this));

    this.socket.on("login", function(data) {
        if(data.name == undefined || data.pw == undefined)
            return;
        if(data.pw.length > 100)
            data.pw = data.pw.substring(0, 100);
        if(this.name == "")
            this.login(data.name, data.pw);
    }.bind(this));

    this.socket.on("register", function(data) {
        if(data.name == undefined || data.pw == undefined)
            return;
        if(data.pw.length > 100)
            data.pw = data.pw.substring(0, 100);
        this.register(data.name, data.pw);
    }.bind(this));

    this.socket.on("assignLeader", function(data) {
        if(data.name == undefined)
            return;
        if(Rank.hasPermission(this, "assignLeader")) {
            if(this.channel != null)
                this.channel.changeLeader(data.name);
        }
    }.bind(this));

    this.socket.on("promote", function(data) {
        if(data.name == undefined)
            return;
        if(Rank.hasPermission(this, "promote")) {
            if(this.channel != null) {
                this.channel.promoteUser(this, data.name);
            }
        }
    }.bind(this));

    this.socket.on("demote", function(data) {
        if(Rank.hasPermission(this, "promote")) {
            if(this.channel != null) {
                this.channel.demoteUser(this, data.name);
            }
        }
    }.bind(this));

    this.socket.on("chatMsg", function(data) {
        if(this.name != "" && this.channel != null) {
            this.channel.chatMessage(this, data.msg);
        }
    }.bind(this));

    this.socket.on("playerReady", function() {
        if(this.channel != null) {
            this.channel.sendMediaUpdate(this);
        }
        this.playerReady = true;
    }.bind(this));

    this.socket.on("queue", function(data) {
        if(this.channel == null)
            return;
        if(Rank.hasPermission(this, "queue") ||
            this.channel.leader == this ||
            !this.channel.qlocked) {
                if(data.pos == "next" && 
                    !this.channel.qopts_allow_qnext &&
                    this.channel.leader != this &&
                    !Rank.hasPermission(this, "queue"))
                    return;
                this.channel.enqueue(data);
        }
    }.bind(this));

    this.socket.on("unqueue", function(data) {
        if(this.channel == null)
            return;
        if(Rank.hasPermission(this, "queue") ||
            this.channel.leader == this ||
            this.channel.opts.qopen_allow_delete && !this.channel.qlocked) {
                this.channel.unqueue(data);
        }
    }.bind(this));

    this.socket.on("moveMedia", function(data) {
        if(this.channel == null)
            return;
        if(Rank.hasPermission(this, "queue") ||
            this.channel.leader == this ||
            this.channel.opts.qopen_allow_move && !this.channel.qlocked ) {
                this.channel.moveMedia(data);
        }
    }.bind(this));

    this.socket.on("jumpTo", function(data) {
        if(this.channel == null || data.pos == undefined)
            return;
        if(Rank.hasPermission(this, "jump") ||
            this.channel.leader == this) {
            this.channel.jumpTo(data.pos);
        }
    }.bind(this));

    this.socket.on("playNext", function() {
        if(this.channel == null)
            return;
        if(Rank.hasPermission(this, "queue") ||
            this.channel.leader == this ||
            this.channel.opts.qopen_allow_playnext && !this.channel.qlocked) {
                if(this.channel.currentPosition + 1 >= this.channel.queue.length) {
                    this.channel.currentPosition = -1;
                }
                this.channel.playNext();
        }
    }.bind(this));

    this.socket.on("queueLock", function(data) {
        if(Rank.hasPermission(this, "qlock")) {
            if(this.channel != null) {
                this.channel.setLock(data.locked);
            }
        }
    }.bind(this));

    this.socket.on("mediaUpdate", function(data) {
        if(this.channel != null && this.channel.leader == this) {
            this.channel.update(data);
        }
    }.bind(this));

    this.socket.on("searchLibrary", function(data) {
        if(this.channel != null &&  Rank.hasPermission(this, "search")) {
            this.socket.emit("librarySearchResults", {
                results: this.channel.searchLibrary(data.query)
            });
        }
    }.bind(this));

    this.socket.on("closePoll", function() {
        if(Rank.hasPermission(this, "poll")) {
            if(this.channel != null && this.channel.poll) {
                this.channel.poll = null;
                this.channel.broadcastPollClose();
            }
        }
    }.bind(this));

    this.socket.on("vote", function(data) {
        if(this.channel != null && this.channel.poll) {
            this.channel.poll.vote(this.ip, data.option);
            this.channel.broadcastPollUpdate();
        }
    }.bind(this));

    this.socket.on("registerChannel", function(data) {
        if(this.channel == null) {
            this.socket.emit("channelRegistration", {
                success: false,
                error: "You're not in any channel!"
            });
        }
        else {
            this.channel.tryRegister(this);
        }
    }.bind(this));

    this.socket.on("adm", function(data) {
        if(Rank.hasPermission(this, "acp")) {
            this.handleAdm(data);
        }
    }.bind(this));

    this.socket.on("announce", function(data) {
        if(Rank.hasPermission(this, "announce")) {
            if(data.clear) {
                Server.announcement = null;
            }
            else {
                Server.io.sockets.emit("announcement", data);
                Server.announcement = data;
            }
        }
    }.bind(this));

    this.socket.on("channelOpts", function(data) {
        if(Rank.hasPermission(this, "channelOpts") && this.channel != null) {
            this.channel.opts = data;
            this.channel.broadcastOpts();
        }
    }.bind(this));
}

// Handle administration
User.prototype.handleAdm = function(data) {
    if(data.cmd == "listchannels") {
        var chans = [];
        for(var chan in Server.channels) {
            var nowplaying = "-";
            if(Server.channels[chan].currentMedia != null)
                nowplaying = Server.channels[chan].currentMedia.title;
            chans.push({
                name: chan,
                usercount: Server.channels[chan].users.length,
                nowplaying: nowplaying
            });
        }
        this.socket.emit("adm", {
            cmd: "listchannels",
            chans: chans
        });
    }
    else if(data.cmd == "listusers") {
        var users = [];
        var dbusers = Database.listUsers();
        if(!dbusers)
            return;
        for(var i = 0; i < dbusers.length; i++) {
            users[i] = {
                name: dbusers[i].uname,
                rank: dbusers[i].global_rank
            };
        }
        this.socket.emit("adm", {
            cmd: "listusers",
            users: users
        });
    }
    else if(data.cmd == "listchannelranks") {
        if(data.chan == undefined)
            return;
        this.socket.emit("adm", {
            cmd: "listchannelranks",
            ranks: Database.listChannelRanks(data.chan)
        });
    }

};

// Attempt to login
User.prototype.login = function(name, pw) {
    if(this.channel != null && name != "") {
        for(var i = 0; i < this.channel.users.length; i++) {
            if(this.channel.users[i].name == name) {
                this.socket.emit("login", {
                    success: false,
                    error: "The username " + name + " is already in use on this channel"
                });
                return false;
            }
        }
    }
    // No password => try guest login
    if(pw == "") {
        // Sorry bud, can"t take that name
        if(Auth.isRegistered(name)) {
            this.socket.emit("login", {
                success: false,
                error: "That username is already taken"
            });
            return false;
        }
        // YOUR ARGUMENT IS INVALID
        else if(!Auth.validateName(name)) {
            this.socket.emit("login", {
                success: false,
                error: "Invalid username.  Usernames must be 1-20 characters long and consist only of alphanumeric characters and underscores"
            });
        }
        // Woah, success!
        else {
            Logger.syslog.log(this.ip + " signed in as " + name);
            this.name = name;
            this.loggedIn = false;
            this.socket.emit("login", {
                success: true
            });
            this.socket.emit("rank", {
                rank: this.rank
            });
            if(this.channel != null) {
                this.channel.logger.log(this.ip + " signed in as " + name);
                if(this.rank >= Rank.Moderator)
                    this.channel.sendPlaylist(this);
                this.channel.broadcastNewUser(this);
            }
        }
    }
    else {
        var row;
        if((row = Auth.login(name, pw))) {
            this.loggedIn = true;
            this.socket.emit("login", {
                success: true
            });
            Logger.syslog.log(this.ip + " logged in as " + name);
            // Sweet, let"s look up our rank
            var chanrank = (this.channel != null) ? this.channel.getRank(name)
                                                  : Rank.Guest;
            var rank = (chanrank > row.global_rank) ? chanrank
                                                     : row.global_rank;
            this.rank = (this.rank > rank) ? this.rank : rank;
            this.socket.emit("rank", {
                rank: this.rank
            });
            this.name = name;
            if(this.channel != null) {
                this.channel.logger.log(this.ip + " logged in as " + name);
                if(this.rank >= Rank.Moderator)
                    this.channel.sendPlaylist(this);
                this.channel.broadcastNewUser(this);
            }
        }
        // Wrong password
        else {
            this.socket.emit("login", {
                success: false,
                error: "Invalid username/password pair"
            });
            return false;
        }
    }
}

// Attempt to register a user account
User.prototype.register = function(name, pw) {
    if(pw == "") {
        // Sorry bud, password required
        this.socket.emit("register", {
            success: false,
            error: "You must provide a password"
        });
        return false;
    }
    else if(Auth.isRegistered(name)) {
        this.socket.emit("register", {
            success: false,
            error: "That username is already taken"
        });
        return false;
    }
    else if(!Auth.validateName(name)) {
        this.socket.emit("register", {
            success: false,
            error: "Invalid username.  Usernames must be 1-20 characters long and consist only of alphanumeric characters and underscores"
        });
    }
    else if(Auth.register(name, pw)) {
        console.log(this.ip + " registered " + name);
        this.socket.emit("register", {
            success: true
        });
        this.login(name, pw);
    }
    else {
        this.socket.emit("register", {
            success: false,
            error: "[](/ppshrug) Registration Failed."
        });
    }
}

exports.User = User;
