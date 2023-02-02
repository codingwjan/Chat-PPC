import React from 'react';
import socketIOClient from "socket.io-client";
import './login.css';

const socket = socketIOClient('http://localhost:3001');

socket.on("user connected", (data) => {
    console.log(data);
});

socket.emit("test", "login window");

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

    if (localStorage.getItem("username") !== null) {
        //make the input field have the username
        //document.getElementsByClassName("loginContainerInput")[0].value = localStorage.getItem("username");
    }


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
        //reduce the size of the profile picture to 90x90
        //let profilePicture = document.getElementById("profilePictureSelector").files[0];
        //check if the profile picture is too big
        //if (profilePicture.size > 1000000) {
            //make the input field have a red glow if the profile picture is too big
            //document.getElementById("profilePictureSelector").style.boxShadow = "0 0 10px red";
            //make the glow back to normal after 1 second
            //setTimeout(function () {
                //document.getElementById("profilePictureSelector").style.boxShadow = "0 0 10px #0081F5";
            //}, 1000);
            //return;
        //}
        //resize the profile picture
        //resizeImage(profilePicture, 90, 90, function (resizedImage) {
            //save the resized image as profile picture
        //    profilePicture = resizedImage;
        //});
        //convert the profile picture to binary
        //let reader = new FileReader();
        //reader.readAsDataURL(profilePicture);
        ////reader.onload = function () {
            //save the base64 string in local storage
            ////localStorage.setItem("profilePictureBase64", reader.result);
        ////}
        //reader.onerror = function (error) {
            //console.log('Error: ', error);
        //}

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
            uuid: uuid
            //profilePicture: profilePicture
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