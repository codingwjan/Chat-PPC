import './App.css';
import socketIOClient from "socket.io-client";
import SideBarBodyContentItem from "./sideBarBodyContentItem";
import {useState} from "react";


//connect to socket on localhost:3001
const socket = socketIOClient('http://localhost:3001');


//connect to socket on localhost:3001
window.onload = function () {
    socket.emit("test", "chat window")
}

socket.emit("requestUsers", "");

socket.on("users", (data) => {
    console.log(data);
    // decode the data
    let users = JSON.parse(data);
    // update the state with the new users
    this.setState({ users });
});


function App() {
    //define users state
    const [users, setUsers] = useState([]);

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
                            <div className="userName">Monkey Yay</div>
                            <div className="changeUserName">Change Username</div>
                        </div>
                    </div>
                    <div className="seperator"/>
                    <div className="sideBarBody">
                        <div className="sideBarBodyHeader">
                            <div className="sideBarTitle">People Online:</div>
                        </div>
                        <div id="sideBarBodyContent">

                            {users.map((user, index ) => {
                                const userData = {
                                    name: user.username
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
                        <div className="chatWindowBodyMessage">
                            <div className="chatWindowBodyMessageLeft">
                                <div className="userIconContainer">
                                    <img className="userIcon"
                                         src="https://www.hdwallpaper.nu/wp-content/uploads/2017/02/monkey-11.jpg"
                                         alt="user icon"/>
                                </div>
                                <div className="chatWindowBodyMessageRight">
                                    <div className="chatWindowBodyMessageRightTop">
                                        <div className="chatWindowBodyMessageUserName">Monkey Yay</div>
                                        <div className="chatWindowBodyMessageTime">12:00</div>
                                    </div>
                                    <div className="chatWindowBodyMessageRightBottom">
                                        <div className="chatWindowBodyMessageText">Im monkey what u want</div>
                                    </div>
                                </div>
                            </div>
                        </div>

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
                                <input className="chatWindowFooterCenterItemInput" type="text"
                                       placeholder="Type a message..."/>
                            </div>
                        </div>
                        <div className="chatWindowFooterRight">
                            <div className="chatWindowFooterRightItem">
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

export default App;
