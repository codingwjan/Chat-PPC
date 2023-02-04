const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs");
const e = require("express");
require('dotenv').config();
const apiKey = process.env.OPENAI_API_KEY;

let connectionCount = 0;


const httpServer = require("http").createServer();
const io = require("socket.io")(httpServer, {
    //set socket.io to listen on the same port as the express server
    cors: {origin: "*"}
});


//repeat every 2 seconds
setInterval(() => {
    //get the data from users.json
    let users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
    //filter the users to only show online users
    let onlineUsers = users.filter((user) => {
        return user.isOnline === true;
    });
    //if there are online users
    if (onlineUsers.length > 0) {
        //stringify the data
        let onlineUsersStringified = JSON.stringify(onlineUsers);
        //send the data to the client
        io.emit("onlineUsers", onlineUsersStringified);
    }

    //get the data from chat.json
    let messages = JSON.parse(fs.readFileSync(path.join(__dirname, "chat.json")));
    //stringify the data
    let messagesStringified = JSON.stringify(messages);
    //send the data to the client
    io.emit("messages", messagesStringified);

}, 1000);

io.on("connection", (socket) => {
    connectionCount++;
    console.log(`Total connections: ${connectionCount}`);

    socket.on("pong" , (data) => {
        //look for the uuid that was given in the data
        let users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
        //for each user in the users.json file
        users.forEach((user) => {
            //if the uuid matches the uuid in the data
            if (user.uuid === parseInt(data)) {
                //set the user to online
                user.isOnline = true;
            }
        });
        //write the new data to users.json
        fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(users));
    });

    socket.on("newUserDetails", (data) => {
        //decode the data
        let decodedData = JSON.parse(data);
        //get username and uuid
        let username = decodedData.username;
        let uuid = decodedData.uuid;
        let socketId = socket.id;
        //let profilePicture = decodedData.profilePicture;

        //replace the data:image/png or data:image/jpeg with nothing
        //profilePicture = profilePicture.replace(/^data:image\/(png|jpeg);base64,/, "");

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
                isOnline: true,
                socketId: socketId
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
        //decode the data
        let decodedData = JSON.parse(data);
        //get username and uuid
        let username = decodedData.newusername;
        let uuid = decodedData.uuid;
        let oldUsername = decodedData.oldusername;

        uuid = parseInt(uuid)

        //replace the new username in the users.json file
        let users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
        for (let i = 0; i < users.length; i++) {
            if (users[i].uuid === uuid) {
                //clear the old username
                users[i].username = username;
            }
            //write the new array to the users.json file
            fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(users));
        }
    });

    async function openAI(message) {
        console.log(message);
        const {Configuration, OpenAIApi} = require("openai");
        const configuration = new Configuration({
            organization: "org-HlakusVgHRSN7V75rdzSS8qw",
            apiKey: apiKey
        });
        const openai = new OpenAIApi(configuration);
        const response = await openai.createCompletion({
            model: "text-curie-001",
            prompt: message,
            max_tokens: 500,
            temperature: 1,
        });
        let correctedresponse = response.data.choices[0].text;
        //remove the first 2 \n from the response
        correctedresponse = correctedresponse.substring(2);

        //send the new message to all clients
        io.emit("newMessage", JSON.stringify({
            username: "GPT-3",
            message: correctedresponse,
            uuid: 0,
        }));

        let messages = JSON.parse(fs.readFileSync(path.join(__dirname, "chat.json")));
        messages.push({
            username: "GPT-3",
            message: correctedresponse,
            uuid: 0,
        });
        fs.writeFileSync(path.join(__dirname, "chat.json"), JSON.stringify(messages));
    }

    socket.on("sendMessage", (data) => {
        console.log(data)
        //decode the data
        let decodedData = JSON.parse(data);
        //get username and uuid
        let username = decodedData.username;
        let message = decodedData.message;
        let uuid = decodedData.uuid;
        let time = new Date().toLocaleTimeString();

        uuid = parseInt(uuid)


        //if message contains !ai
        if (message.includes("!ai")) {
            openAI(message);
        }

        //send the new message to all clients
        io.emit("newMessage", JSON.stringify({
            username: username,
            message: message,
            uuid: uuid,
            time: time
        }));

        //replace the new username in the users.json file
        let messages = JSON.parse(fs.readFileSync(path.join(__dirname, "chat.json")));
        messages.push({
            username: username,
            message: message,
            uuid: uuid,
            time: time
        });
        //write the new array to the users.json file
        fs.writeFileSync(path.join(__dirname, "chat.json"), JSON.stringify(messages));
    });


    socket.on("disconnect", () => {
        connectionCount--;
        console.log(`Client disconnected. Total connections: ${connectionCount}`);
        //set every user to offline
        let users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
        for (let i = 0; i < users.length; i++) {
            users[i].isOnline = false;
        }
        //write the new array to the users.json file
        fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(users));
    });
});


    const port = 3001;

    httpServer.listen(port, () => {
        console.log("Server started on port:" + port);
    });