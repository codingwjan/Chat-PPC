import react from 'react';
import './App.css';

const ChatWindowBodyMessage = (props) => {
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
                      <div className="chatWindowBodyMessageUserName">Monkey Yay</div>
                      <div className="chatWindowBodyMessageTime">12:00</div>
                  </div>
                  <div className="chatWindowBodyMessageRightBottom">
                      <div className="chatWindowBodyMessageText">Im monkey what u want</div>
                  </div>
              </div>
          </div>
      </div>
  );
}

export default ChatWindowBodyMessage;