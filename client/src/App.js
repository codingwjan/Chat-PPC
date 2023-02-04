import './App.css';
import socketIOClient from "socket.io-client";
import SideBarBodyContentItem from "./sideBarBodyContentItem";
import ChatWindowBodyMessage from "./chatWindowBodyMessage";
import {useState} from "react";


//connect to socket on localhost:3001
const socket = socketIOClient('http://localhost:3001');


const App = () => {
    const [users, setUsers] = useState([]);
    const [messages, setMessages] = useState([]);

    socket.on("onlineUsers", (data) => {
        // decode the data
        let usersData = JSON.parse(data);
        // update the state with the new users
        setUsers(usersData);
    });

    socket.on("messages", (data) => {
        // decode the data
        let messagesData = JSON.parse(data);
        // update the state with the new users

        let chatWindowBody = document.getElementById("chatWindowBody");
        let scrollPosition = chatWindowBody.scrollTop;

        if (scrollPosition === chatWindowBody.scrollHeight - chatWindowBody.clientHeight) {
            setMessages(messagesData);
            chatWindowBody.scrollTop = chatWindowBody.scrollHeight;
        } else {
            setMessages(messagesData);
        }
    });

    socket.on('user connected', (data) => {
        console.log(data);
    });

    socket.on("disconnect", () => {
        console.log("disconnected");
    });

    return (
        <div className="App">
            <div className="container">
                <div className="sideBar">
                    <div className="sideBarHeader">
                        <div className="userIconContainer">
                            <img className="userIcon"
                                 src="https://www.hdwallpaper.nu/wp-content/uploads/2017/02/monkey-11.jpg"
                                 alt="user icon"/>

                        </div>
                        <div className="sideBarHeaderRight">
                            <div id="userName" className="userName">{localStorage.getItem("username")}</div>
                            <div id="changeUserName" className="changeUserName" onClick={changeUserName}>Change Username</div>
                            <div id="saveUserName" className="saveUserName" onClick={saveUserName}>Save Username</div>
                        </div>
                    </div>
                    <div className="seperator"/>
                    <div className="sideBarBody">
                        <div className="sideBarBodyHeader">
                            <div className="sideBarTitle">People Online:</div>
                        </div>
                        <div className="sideBarBodyContent" id="sideBarBodyContent">

                            {users.map((user, index ) => {
                                const userData = {
                                    username: user.username,
                                };
                                return <SideBarBodyContentItem key={index} userData={userData} />;
                            })}
                        </div>
                    </div>
                    <footer className="sideBarFooter">
                        <div className="sideBarFooterLeft">
                            <div className="sideBarFooterLeftItem">About</div>
                            <div className="sideBarFooterLeftItem">Contact</div>
                            <div className="sideBarFooterLeftItem">Impressum</div>

                        </div>
                    </footer>
                </div>
                <div className="chatWindow">
                    <div className="chatWindowHeader">
                        <div className="chatWindowHeaderTitle">Chat PPC</div>
                        <div className="chatWindowHeaderSubtitle">by ebayboy & cancelcloud</div>
                    </div>
                    <div className="chatWindowBody">
                        {messages.map((message, index) => {
                            //replace \n with <br>  inside the message
                            const messageData = {
                                username: message.username,
                                message: message.message,
                                time: message.time
                            };
                            return <ChatWindowBodyMessage key={index} messageData={messageData} />;
                        })}



                    </div>
                    <div className="chatWindowFooter">
                        <div className="chatWindowFooterLeft">
                            <div className="chatWindowFooterLeftItem">
                                <svg xmlns="http://www.w3.org/2000/svg"
                                     className="icon icon-tabler icon-tabler-chart-bar" width="24" height="24"
                                     viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none"
                                     stroke-linecap="round" stroke-linejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                                    <path
                                        d="M3 12m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"></path>
                                    <path
                                        d="M9 8m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"></path>
                                    <path
                                        d="M15 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"></path>
                                    <path d="M4 20l14 0"></path>
                                </svg>
                            </div>
                            <div className="chatWindowFooterLeftItem">
                                <svg xmlns="http://www.w3.org/2000/svg"
                                     className="icon icon-tabler icon-tabler-photo" width="24" height="24"
                                     viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none"
                                     stroke-linecap="round" stroke-linejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                                    <path d="M15 8l.01 0"></path>
                                    <path
                                        d="M4 4m0 3a3 3 0 0 1 3 -3h10a3 3 0 0 1 3 3v10a3 3 0 0 1 -3 3h-10a3 3 0 0 1 -3 -3z"></path>
                                    <path d="M4 15l4 -4a3 5 0 0 1 3 0l5 5"></path>
                                    <path d="M14 14l1 -1a3 5 0 0 1 3 0l2 2"></path>
                                </svg>
                            </div>
                        </div>
                        <div className="chatWindowFooterCenter">
                            <div className="chatWindowFooterCenterItem">
                                <input id="chatWindowFooterCenterItemInput" className="chatWindowFooterCenterItemInput" type="text"
                                       placeholder="Type a message..."/>
                            </div>
                        </div>
                        <div className="chatWindowFooterRight">
                            <div className="chatWindowFooterRightItem" onClick={sendMessage}>
                                <svg xmlns="http://www.w3.org/2000/svg"
                                     className="icon icon-tabler icon-tabler-brand-telegram" width="24" height="24"
                                     viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none"
                                     stroke-linecap="round" stroke-linejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                                    <path d="M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4"></path>
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}


function changeUserName() {
    localStorage.setItem("oldusername", localStorage.getItem("username"));
    //replace the change button with save button
    document.getElementById("changeUserName").style.display = "none";
    document.getElementById("saveUserName").style.display = "block";

    //make div editable
    document.getElementById("userName").contentEditable = true;
    document.getElementById("userName").focus();
}

function saveUserName() {
    //replace the save button with change button
    document.getElementById("saveUserName").style.display = "none";
    document.getElementById("changeUserName").style.display = "block";

    //make div editable
    document.getElementById("userName").contentEditable = false;

    //save the new username
    var newUserName = document.getElementById("userName").innerHTML;
    localStorage.setItem("username", newUserName);
    console.log("new username: " + localStorage.getItem("username"));

    console.log("update request sent")

    //emit the new username with the uuid from local storage and the old username to the server
    socket.emit("changeUserName", JSON.stringify({
        uuid: localStorage.getItem("uuid"),
        oldusername: localStorage.getItem("oldusername"),
        newusername: localStorage.getItem("username")
    }));

}

//listen for if enter is pressed
document.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
        sendMessage();
    }
});

function sendMessage() {
    //if the message contains more than spaces or is empty, don't send it
    if (document.getElementsByClassName("chatWindowFooterCenterItemInput")[0].value.trim() === "") {
        return;
    } else {
        var message = document.getElementsByClassName("chatWindowFooterCenterItemInput")[0].value;
        document.getElementsByClassName("chatWindowFooterCenterItemInput")[0].value = "";

        console.log("message: " + message);

        //emit the message to the server
        socket.emit("sendMessage", JSON.stringify({
            uuid: localStorage.getItem("uuid"),
            username: localStorage.getItem("username"),
            message: message,
            time: new Date().toLocaleTimeString()
        }));
    }
}

//repeat every 5 seconds
setInterval(ping, 5000);

function ping() {
    console.log("ping")
    socket.emit("pong", localStorage.getItem("uuid"));
}

export default App;