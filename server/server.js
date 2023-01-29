const express = require("express");
const app = express();


const httpServer = require("http").createServer();
const io = require("socket.io")(httpServer, {
    //set socket.io to listen on the same port as the express server
    cors: {origin: "*"}
});

io.on("connection", (socket) => {
    console.log("New client connected");
    socket.emit("user connected", "connected to server");

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

const port = 3001;

httpServer.listen(port, () => {
    console.log("Server started on port:"+port);
});