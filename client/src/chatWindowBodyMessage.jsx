import react from 'react';
import './App.css';

const ChatWindowBodyMessage = ({messageData}) => {
  return (
      <div className="chatWindowBodyMessage">
          <div className="chatWindowBodyMessageLeft">
              <div className="userIconContainer">
                  <img className="userIcon"
                       src="https://www.hdwallpaper.nu/wp-content/uploads/2017/02/monkey-11.jpg"
                       alt="user icon"/>
              </div>
              <div className="chatWindowBodyMessageRight">
                  <div className="chatWindowBodyMessageRightTop">
                      <div className="chatWindowBodyMessageUserName">{messageData.username}</div>
                      <div className="chatWindowBodyMessageTime">{
                            messageData.time
                      }</div>
                  </div>
                  <div className="chatWindowBodyMessageRightBottom">
                      <div className="chatWindowBodyMessageText">{
                            //messageData.message but \n is not working
                            messageData.message.split('').map((word, index) => {
                                if (word === '\n') {
                                    return <br key={index}/>
                                }
                                return word + ''
                            }
                            )
                      }</div>
                  </div>
              </div>
          </div>
      </div>
  );
}

export default ChatWindowBodyMessage;