import './App.css';
import socketIOClient from "socket.io-client";
import SideBarBodyContentItem from "./sideBarBodyContentItem";
import ChatWindowBodyMessage from "./chatWindowBodyMessage";
import {useState} from "react";
import VotingWidget from "./votingWidget";
import {v4 as uuidv4} from 'uuid';


//connect to socket on localhost:3001
const socket = socketIOClient('http://localhost:3001');


const App = () => {
    if(document.cookie !== "isLoggedIn=true"){
        window.location.href = "/login";
    }
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

        setMessages(messagesData);
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
                                 src="https://www.nailseatowncouncil.gov.uk/wp-content/uploads/blank-profile-picture-973460_1280.jpg"
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
                                    status: user.status,
                                    profilePicture: user.profilePicture
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
                            //if the type is votingPoll, create a votingPoll
                            if (message.type === "votingPoll") {
                                const votingPollData = {
                                    username: message.username,
                                    message: message.message,
                                    time: message.time,
                                    optionone: message.optionone,
                                    optiontwo: message.optiontwo,
                                    uuid: message.uuid,
                                    uuid1: message.uuid1,
                                    uuid2: message.uuid2,
                                    resultone: message.resultone,
                                    resulttwo: message.resulttwo,
                                    socket: socket
                                };
                                return <VotingWidget key={index} votingPollData={votingPollData}/>;
                            }
                            //else create a normal message
                            else if (message.type === "message") {
                                const messageData = {
                                    username: message.username,
                                    message: message.message,
                                    time: message.time,
                                    profilePicture: message.profilePicture
                                };
                                return <ChatWindowBodyMessage key={index} messageData={messageData}/>;
                            }
                        })}



                    </div>
                    <div className="chatWindowFooter">
                        <div className="chatWindowFooterLeft">
                            <div className="chatWindowFooterLeftItem" onClick={createVotingPoll} id="chatWindowFooterLeftItem">
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
                            <div className="chatWindowFooterLeftItemHidden" id="chatWindowFooterLeftItemHidden" onClick={createVotingPoll}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-tabler icon-tabler-x"
                                     width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
                                     fill="none" stroke-linecap="round" stroke-linejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                                    <path d="M18 6l-12 12"></path>
                                    <path d="M6 6l12 12"></path>
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
                                       placeholder="Type a message..." onFocus={startTypingMessage} onBlur={stopTyping}/>
                                <input id="createVotingPollInput" className="chatWindowFooterCenterItemInputHidden" type="text" placeholder="Enter a question..."/>
                                <input id="votingPollOption1" className="chatWindowFooterCenterItemInputHidden" type="text" placeholder="Enter option 1..."/>
                                <input id="votingPollOption2" className="chatWindowFooterCenterItemInputHidden" type="text" placeholder="Enter option 2..."/>
                            </div>
                        </div>
                        <div className="chatWindowFooterRight">
                            <div id="chatWindowFooterRightItemHidden" className="chatWindowFooterRightItemHidden" onClick={sendVotingPoll}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-tabler icon-tabler-check"
                                     width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"
                                     fill="none" stroke-linecap="round" stroke-linejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                                    <path d="M5 12l5 5l10 -10"></path>
                                </svg>
                            </div>
                            <div id="chatWindowFooterRightItem" className="chatWindowFooterRightItem" onClick={sendMessage}>
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

    //emit the new username with the uuid from local storage and the old username to the server
    socket.emit("changeUserName", JSON.stringify({
        uuid: localStorage.getItem("uuid"),
        oldusername: localStorage.getItem("oldusername"),
        newusername: localStorage.getItem("username")
    }));

}

function startTypingMessage() {
    startTyping("typing...");
}

function startTyping(data) {
    //emit the uuid from local storage and the username to the server
    socket.emit("startTyping", JSON.stringify({
        uuid: localStorage.getItem("uuid"),
        status: data
    }));
}

function stopTyping() {
    //emit the uuid from local storage and the username to the server
    socket.emit("stopTyping", JSON.stringify({
        uuid: localStorage.getItem("uuid"),
        status: ""
    }));
}

function createVotingPoll() {
    //check if currently creating a voting poll and if so, go back to normal
    if (document.getElementById("createVotingPollInput").style.display === "block") {
        startTyping("");
        document.getElementById("chatWindowFooterCenterItemInput").style.display = "block";
        document.getElementById("createVotingPollInput").style.display = "none";
        document.getElementById("votingPollOption1").style.display = "none";
        document.getElementById("votingPollOption2").style.display = "none";
        document.getElementById("chatWindowFooterRightItem").style.display = "flex";
        document.getElementById("chatWindowFooterRightItemHidden").style.display = "none";
        document.getElementById("chatWindowFooterLeftItem").style.display = "flex";
        document.getElementById("chatWindowFooterLeftItemHidden").style.display = "none";
        return;
    } else {
        startTyping("creating voting poll...");
        //remove the middle input field and replace with 3 input fields
        document.getElementById("chatWindowFooterCenterItemInput").style.display = "none";
        document.getElementById("createVotingPollInput").style.display = "block";
        document.getElementById("votingPollOption1").style.display = "block";
        document.getElementById("votingPollOption2").style.display = "block";
        document.getElementById("chatWindowFooterRightItem").style.display = "none";
        document.getElementById("chatWindowFooterRightItemHidden").style.display = "flex";
        document.getElementById("chatWindowFooterLeftItem").style.display = "none";
        document.getElementById("chatWindowFooterLeftItemHidden").style.display = "flex";
    }
}

function sendVotingPoll() {
    startTyping("");
    //if the message contains more than spaces or is empty, don't send it
    if (document.getElementById("createVotingPollInput").value.trim() === "") {
        return;
    } else {
        var message = document.getElementById("createVotingPollInput").value;
        document.getElementById("createVotingPollInput").value = "";

        var optionone = document.getElementById("votingPollOption1").value;
        document.getElementById("votingPollOption1").value = "";

        var optiontwo = document.getElementById("votingPollOption2").value;
        document.getElementById("votingPollOption2").value = "";

        document.getElementById("chatWindowFooterRightItem").style.display = "flex";
        document.getElementById("chatWindowFooterRightItemHidden").style.display = "none";
        document.getElementById("chatWindowFooterLeftItem").style.display = "flex";
        document.getElementById("chatWindowFooterLeftItemHidden").style.display = "none";

        //generate 2 random uuids for the voting poll
        let uuid1 = uuidv4();
        let uuid2 = uuidv4();

        //emit the message to the server
        socket.emit("sendMessage", JSON.stringify({
            uuid: localStorage.getItem("uuid"),
            username: localStorage.getItem("username"),
            message: message,
            optionone: optionone,
            optiontwo: optiontwo,
            time: new Date().toLocaleTimeString(),
            type: "votingPoll",
            uuid1: uuid1,
            uuid2: uuid2
        }));

        //remove the middle input field and replace with 3 input fields
        document.getElementById("chatWindowFooterCenterItemInput").style.display = "block";
        document.getElementById("createVotingPollInput").style.display = "none";
        document.getElementById("votingPollOption1").style.display = "none";
        document.getElementById("votingPollOption2").style.display = "none";
    }
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

        //emit the message to the server
        socket.emit("sendMessage", JSON.stringify({
            uuid: localStorage.getItem("uuid"),
            username: localStorage.getItem("username"),
            message: message,
            time: new Date().toLocaleTimeString(),
            type: "message"
        }));
    }
}

//repeat every 5 seconds
setInterval(ping, 5000);

function ping() {
    socket.emit("pong", localStorage.getItem("uuid"));
}

export default App;