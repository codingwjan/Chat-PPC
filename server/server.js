const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs");


const httpServer = require("http").createServer();
const io = require("socket.io")(httpServer, {
    //set socket.io to listen on the same port as the express server
    cors: {origin: "*"}
});

io.on("connection", (socket) => {
    console.log("New client connected");

    socket.on("newUserDetails", (data) => {
        //console log with date and time the data
        console.log(new Date().toLocaleString() + " " + data);
        //decode the data
        let decodedData = JSON.parse(data);
        //get username and uuid
        let username = decodedData.username;
        let uuid = decodedData.uuid;
        let profilePicture = decodedData.profilePicture;

        //if username is on blacklist.json
        if (fs.readFileSync(path.join(__dirname, "blacklist.json")).includes(username)) {
            //send userNotLoggedIn to the client
            socket.emit("userNotLoggedIn", "Username is not allowed");
        } else {
            //send userLoggedIn to the client
            socket.emit("userLoggedIn", "Username is allowed");
            //add user to array list
            let users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
            users.push({
                username: username,
                uuid: uuid,
                profilePicture: profilePicture
            });

            //write the new array to the users.json file
            fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(users));

            //send new username and profile picture to all clients
            io.emit("newUser", JSON.stringify({
                username: username,
                profilePicture: profilePicture
            }));

        }

        //add 5 seconds delay
        setTimeout(() => {
//send new username and profile picture to all clients
            io.emit("newUser", JSON.stringify({
                username: username,
                profilePicture: profilePicture
            }));
        }, 5000);
    });
    socket.on("disconnect", () => {
        //check when the client disconnects and remove the user from the users.json file
        console.log("Client disconnected");
    });
});

const port = 3001;

httpServer.listen(port, () => {
    console.log("Server started on port:" + port);
});