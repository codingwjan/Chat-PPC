import './App.css';

const SideBarBodyContentItem = ({userData}) => {
return (
    <div className="sideBarBodyContentItem">
        <div className="sideBarBodyContentItemLeft">
            <img src="https://www.hdwallpaper.nu/wp-content/uploads/2017/02/monkey-11.jpg" alt="Avatar" className="userIcon"/>
        </div>
        <div className="sideBarBodyContentItemRight">
            <div className="sideBarBodyUserName">{userData.username}</div>
        </div>
    </div>
)}

export default SideBarBodyContentItem;