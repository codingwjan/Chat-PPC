import React from 'react';
import socketIOClient from "socket.io-client";
import './login.css';

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
                        <button className="loginContainerSubmitButton" onClick={submitUsername}>Login</button>
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
        //check the size of the profile picture
        let profilePicture = document.getElementById("profilePictureSelector").files[0];
        if (profilePicture) {
            //check if the profile picture is bigger than 1mb
            if (profilePicture.size > 1000000) {
                //resize the image
                resizeImage(profilePicture, 1000, 1000, function (dataUrl) {
                    //save the base64 in local storage
                    localStorage.setItem("profilePictureBase64", dataUrl);
                });
            } else {
                //save the base64 in local storage
                localStorage.setItem("profilePictureBase64", profilePicture);
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




        //make the profile picture have the base64
        //profilePicture = localStorage.getItem("profilePictureBase64");
        //console.log(profilePicture);

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

function resizeImage(profilePicture, maxWidth, maxHeight, callback) {
    let image = new Image();
    image.src = URL.createObjectURL(profilePicture);
    image.onload = function () {
        let canvas = document.createElement('canvas');
        let width = image.width;
        let height = image.height;

        if (width > height) {
            if (width > maxWidth) {
                height *= maxWidth / width;
                width = maxWidth;
            }
        } else {
            if (height > maxHeight) {
                width *= maxHeight / height;
                height = maxHeight;
            }
        }

        // Resize the canvas to the resized dimensions
        canvas.width = width;
        canvas.height = height;
        let ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, width, height);
        //check if the image is a png
        if (profilePicture.type === "image/png") {
            //convert the image to a png
            var dataUrl = canvas.toDataURL("image/png");
        } else {
            //convert the image to a jpeg
            var dataUrl = canvas.toDataURL("image/jpeg");
        }
        callback(dataUrl);
    }
}


//listen for if user pressed enter in username input
document.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            submitUsername();
        }
    }
);