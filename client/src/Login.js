import React from 'react';
import socketIOClient from "socket.io-client";
import './login.css';
import axios from "axios";

const socket = socketIOClient('http://localhost:3001');

socket.on("user connected", (data) => {
    console.log(data);
});

socket.on("disconnect", () => {
    console.log("disconnected");
});

socket.on("userNotLoggedIn", (data) => {
    //make the input field have a red glow if the username is not allowed
    //Login.document.getElementsByClassName("loginContainerInput")[0].style.boxShadow = "0 0 10px red";
    //make the glow back to normal after 1 second
    setTimeout(function () {
        document.getElementsByClassName("loginContainerInput")[0].style.boxShadow = "0 0 10px #0081F5";
    }, 1000);
});

function Login() {

    //clear the cookies on reload
    document
        .cookie
        .split(";")
        .forEach(function (c) {
                document.cookie = c
                    .replace(/^ +/, "")
                    .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
            }
        );


    return (
        <div className="App">
            <div className="loginTitle">Welcome to Chat PPC</div>
            <div className="loginContainer">
                <div className="loginContainerLeft">
                    <div className="loginContainerInputBox">
                        <input className="loginContainerInput" type="text" placeholder="Username"/>
                        <input id="profilePictureSelector" className="profilePictureSelector" type="file"/>
                        <button id='loginContainerSubmitButton' className="loginContainerSubmitButton" onClick={submitUsername}>Login</button>
                    </div>
                </div>
            </div>
        </div>
    );

}

export default Login;

function submitUsername() {
    //console log the content of the input field if the input field is obove 2 characters
    let username = document.getElementsByClassName("loginContainerInput")[0].value;
    if (username.length > 2) {
        document.getElementById('loginContainerSubmitButton').style.pointerEvents = "none";
        document.getElementById('loginContainerSubmitButton').style.cursor = "not-allowed";
        //check the size of the profile picture
        let profilePicture = document.getElementById("profilePictureSelector").files[0];
        if (profilePicture) {
            //check if the profile picture is bigger than 1mb
            if (profilePicture.size > 1000000) {
                //make the input field have a red glow if the profile picture is bigger than 1mb
                document.getElementsByClassName("loginContainerInput")[0].style.boxShadow = "0 0 10px red";
                //make the glow back to normal after 1 second
                setTimeout(function () {
                    document.getElementsByClassName("loginContainerInput")[0].style.boxShadow = "0 0 10px #0081F5";
                }, 1000);
                return;
            } else {
                //create a new form data
                let formData = new FormData();
                //append the profile picture to the form data
                formData.append("file", profilePicture);
                //send the form data to the server
                axios.post("http://localhost:3001/pictures", formData, {
                    headers: {
                        'Content-Type': 'multipart/form-data'
                    }
                }).then((response) => {
                    //save the profile picture in local storage
                    localStorage.setItem("profilePicture", response.data);
                }).catch((error) => {
                    console.log(error);
                });

            }
        } else {
            profilePicture = "https://www.nailseatowncouncil.gov.uk/wp-content/uploads/blank-profile-picture-973460_1280.jpg"
            //save the profile picture in local storage
            localStorage.setItem("profilePicture", profilePicture);
        }

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