const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs");
require('dotenv').config();
const apiKey = process.env.OPENAI_API_KEY;
const {stringify} = require("nodemon/lib/utils");

let connectionCount = 0;


const httpServer = require("http").createServer();
const io = require('socket.io')(3001, {
    cors: {
        origin: "http://192.168.2.151:3000",
        methods: ["GET", "POST"]
    }
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
        console.log(data)
        //decode the data
        let decodedData = JSON.parse(data);
        //get username and uuid
        let username = decodedData.username;
        let uuid = decodedData.uuid;
        let socketId = socket.id;
        let profilePicture = decodedData.profilePicture;

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
                socketId: socketId,
                profilePicture: profilePicture
            });

            //write the new array to the users.json file
            fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(users));

        }

        //add 5 seconds delay
        setTimeout(() => {
        //send new username and profile picture to all clients
            io.emit("newUser", JSON.stringify({
                username: username,
                profilePicture: profilePicture
            }));
        }, 1000);
    });

    socket.on("changeUserName", (data) => {
        //decode the data
        let decodedData = JSON.parse(data);
        //get username and uuid
        let username = decodedData.newusername;
        let uuid = decodedData.uuid;

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

    socket.on("startTyping", (data) => {
        console.log(data);
        //decode the data
        let decodedData = JSON.parse(data);
        //get username and uuid
        let uuid = decodedData.uuid;
        let status = decodedData.status;

        uuid = parseInt(uuid)

        //search for the user in the users.json file
        let users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
        for (let i = 0; i < users.length; i++) {
            if (users[i].uuid === uuid) {
                console.log("found user")
                //set the user to typing
                users[i].status = status;
            }
            //write the new array to the users.json file
            fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(users));
        }
    });

    socket.on("stopTyping", (data) => {
        console.log(data);
        //decode the data
        let decodedData = JSON.parse(data);
        //get username and uuid
        let uuid = decodedData.uuid;
        let status = decodedData.status;

        uuid = parseInt(uuid)

        //search for the user in the users.json file
        let users = JSON.parse(fs.readFileSync(path.join(__dirname, "users.json")));
        for (let i = 0; i < users.length; i++) {
            if (users[i].uuid === uuid) {
                console.log("found user")
                //set the user to typing
                users[i].status = status;
            }
            //write the new array to the users.json file
            fs.writeFileSync(path.join(__dirname, "users.json"), JSON.stringify(users));
        }
    });

    async function openAI(message, time) {
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
            profilePicture: "https://nowmag.gr/wp-content/uploads/2020/07/gpt3-1024x500.jpg",
        }));

        let messages = JSON.parse(fs.readFileSync(path.join(__dirname, "chat.json")));
        messages.push({
            username: "GPT-3",
            message: correctedresponse,
            uuid: 0,
            time: time,
            type: "message",
            profilePicture: "https://nowmag.gr/wp-content/uploads/2020/07/gpt3-1024x500.jpg",
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
        let type = decodedData.type;
        let optionone = decodedData.optionone;
        let optiontwo = decodedData.optiontwo;
        let uuid1 = decodedData.uuid1;
        let uuid2 = decodedData.uuid2;
        let profilePicture = "https://www.nailseatowncouncil.gov.uk/wp-content/uploads/blank-profile-picture-973460_1280.jpg"

        uuid = parseInt(uuid)


        //if message contains !ai
        if (message.includes("!ai")) {
            openAI(message, time);
        }

        //send the new message to all clients
        io.emit("newMessage", JSON.stringify({
            username: username,
            message: message,
            uuid: uuid,
            time: time,
            type: type,
            optionone: optionone,
            optiontwo: optiontwo,
            uuid1: uuid1,
            uuid2: uuid2,
            profilePicture: profilePicture
        }));

        //replace the new username in the users.json file
        let messages = JSON.parse(fs.readFileSync(path.join(__dirname, "chat.json")));
        messages.push({
            username: username,
            message: message,
            uuid: uuid,
            time: time,
            type: type,
            optionone: optionone,
            optiontwo: optiontwo,
            uuid1: uuid1,
            uuid2: uuid2,
            profilePicture: profilePicture,
            resultone: "0",
            resulttwo: "0"
        });
        //write the new array to the users.json file
        fs.writeFileSync(path.join(__dirname, "chat.json"), JSON.stringify(messages));
    });

    socket.on("voteLeft", (data) => {
        let messages = JSON.parse(fs.readFileSync(path.join(__dirname, "chat.json")));
        for (let i = 0; i < messages.length; i++) {
            let votesLeft = parseInt(messages[i].resultone)
            votesLeft++;
            messages[i].resultone=stringify(votesLeft);
        }
        fs.writeFileSync(path.join(__dirname, "chat.json"), JSON.stringify(messages));

    });

    socket.on("voteRight", (data) => {
        let messages = JSON.parse(fs.readFileSync(path.join(__dirname, "chat.json")));
        for (let i = 0; i < messages.length; i++) {
            let votesLeft = parseInt(messages[i].resulttwo)
            votesLeft++;
            messages[i].resulttwo=stringify(votesLeft);
        }
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