const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs");
const e = require("express");

let connectionCount = 0;


const httpServer = require("http").createServer();
const io = require("socket.io")(httpServer, {
    //set socket.io to listen on the same port as the express server
    cors: {origin: "*"}
});

io.on("connection", (socket) => {
    connectionCount++;
    console.log(`Total connections: ${connectionCount}`);

    socket.on("requestUserList", () => {
        console.log("requestUserList");
    });

    socket.on("test", (data) => {
        console.log(data)
    });

    socket.on("newUserDetails", (data) => {
        console.log("newUserDetails")
        console.log(data)
        //decode the data
        let decodedData = JSON.parse(data);
        //get username and uuid
        let username = decodedData.username;
        let uuid = decodedData.uuid;
        //let profilePicture = decodedData.profilePicture;

        console.log(username);

        //replace the data:image/png or data:image/jpeg with nothing
        //profilePicture = profilePicture.replace(/^data:image\/(png|jpeg);base64,/, "");

        //if username is on blacklist.json
        if (fs.readFileSync(path.join(__dirname, "blacklist.json")).includes(username)) {
            //send userNotLoggedIn to the client
            socket.emit("userNotLoggedIn", "Username is not allowed");
        } else {
            //send userLoggedIn to the client
            socket.emit("userLoggedIn", "Username is allowed");
            console.log("userLoggedIn")
            //add user to array list
            let users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
            users.push({
                username: username,
                uuid: uuid
            });

            //write the new array to the users.json file
            fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(users));

        }

        //add 5 seconds delay
        setTimeout(() => {
        //send new username and profile picture to all clients
            io.emit("newUser", JSON.stringify({
                username: username
                //profilePicture: profilePicture
            }));
        }, 1000);
    });

    socket.on("changeUserName", (data) => {
        console.log(data)
        //decode the data
        let decodedData = JSON.parse(data);
        //get username and uuid
        let username = decodedData.newusername;
        let uuid = decodedData.uuid;
        let oldUsername = decodedData.oldusername;

        uuid = parseInt(uuid)

        console.log(username);
        console.log(uuid);
        console.log(oldUsername);

        //replace the new username in the users.json file
        let users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
        for (let i = 0; i < users.length; i++) {
            if (users[i].uuid === uuid) {
                console.log("found user")
                console.log(users[i].username)
                //clear the old username
                users[i].username = username;
            }
            //write the new array to the users.json file
            fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(users));
        }
    });

    //repeat every 2 seconds
    setInterval(() => {
        //get the data from users.json
        let users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
        //stringify the data
        let usersStringified = JSON.stringify(users);
        //send the data to the client
        socket.emit("users", usersStringified);
    }, 5000);


    socket.on("disconnect", () => {
        connectionCount--;
        console.log(`Client disconnected. Total connections: ${connectionCount}`);
    });
    });

    const port = 3001;

    httpServer.listen(port, () => {
        console.log("Server started on port:" + port);
    });