import './App.css';

const SideBarBodyContentItem = ({userData}) => {
return (
    <div className="sideBarBodyContentItem">
        <div className="sideBarBodyContentItemLeft">
            <img src={userData.profilePicture} alt="Avatar" className="userIcon"/>
        </div>
        <div className="sideBarBodyContentItemRight">
            <div className="sideBarBodyUserName">{userData.username}</div>
            <div className="sideBarBodyUserStatus">{userData.status}</div>
        </div>
    </div>
)}

export default SideBarBodyContentItem;