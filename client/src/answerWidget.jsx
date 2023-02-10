import react from "react";
import './App.css';

const AnswerWidget = ({answerData}) => {
    console.log(answerData)
  return (
      <div className="chatWindowBodyMessage">
          <div className="chatWindowBodyMessageLeft">
              <div className="userIconContainer">
                  <img className="userIcon"
                       src={answerData.profilePicture}
                       alt="user icon"/>
              </div>
              <div className="chatWindowBodyMessageRight">
                  <div className="chatWindowBodyMessageRightTop">
                      <div className="chatWindowBodyMessageUserName">{answerData.username}</div>
                      <div className="chatWindowBodyMessageTime">{
                          answerData.time
                      }</div>
                  </div>
                  <div className="chatWindowBodyMessageRightBottom">
                      <div className="chatWindowBodyOriginalMessageText">"{answerData.oldmessage}" - {answerData.oldusername}</div>
                      <div className="chatWindowBodyMessageText">{answerData.message}</div>
                  </div>
              </div>
          </div>
      </div>
  );
};

export default AnswerWidget;