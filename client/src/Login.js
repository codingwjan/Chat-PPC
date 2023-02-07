import React from 'react';
import socketIOClient from "socket.io-client";
import './login.css';

const socket = socketIOClient('http://192.168.2.151:3001');

function Login() {

    return (
        <div className="App">
            <div className="loginTitle">Welcome to Chat PPC</div>
            <div className="loginContainer">
                <div className="loginContainerLeft">
                    <div className="loginContainerInputBox">
                        <input className="loginContainerInput" type="text" placeholder="Username"/>
                        <button id='loginContainerSubmitButton' className="loginContainerSubmitButton" onClick={submitUsername}>Login</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Login;


function submitUsername() {
    console.log("submit username")
    //console log the content of the input field if the input field is obove 2 characters
    let username = document.getElementsByClassName("loginContainerInput")[0].value;
    if (username.length > 2) {
        document.getElementById('loginContainerSubmitButton').style.pointerEvents = "none";
        document.getElementById('loginContainerSubmitButton').style.cursor = "not-allowed";
        //check the size of the profile picture
        let profilePicture = "https://www.nailseatowncouncil.gov.uk/wp-content/uploads/blank-profile-picture-973460_1280.jpg";

        document.cookie = "isLoggedIn=true";

        //create a uuid for the user
        let uuid = Math.floor(Math.random() * 1000000000);
        //save the uuid in local storage
        localStorage.setItem("uuid", uuid);
        //save the username in local storage
        localStorage.setItem("username", document.getElementsByClassName("loginContainerInput")[0].value);

        //sent the username and uuid to the server
        socket.emit("newUserDetails", JSON.stringify({
            username: document.getElementsByClassName("loginContainerInput")[0].value,
            uuid: uuid,
            profilePicture: profilePicture
        }));//
        //redirect to chat page
        window.location.href = "/chat";

    } else {
        //make the input field have a red glow if the input field is below 2 characters
        document.getElementsByClassName("loginContainerInput")[0].style.boxShadow = "0 0 10px red";
        //make the glow back to normal after 1 second
        setTimeout(function () {
            document.getElementsByClassName("loginContainerInput")[0].style.boxShadow = "0 0 10px #0081F5";
        }, 1000);
    }
}


//listen for if user pressed enter in username input
document.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            submitUsername();
        }
    }
);