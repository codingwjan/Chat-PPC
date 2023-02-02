import './App.css';

const SideBarBodyContentItem = ({userData}) => {
return (
    <div className="sideBarBodyContentItem">
        <div className="sideBarBodyContentItemLeft">
            <div className="sideBarBodyContentItemRight">
                <div className="sideBarBodyUserName">{userData.username}</div>
            </div>
        </div>
    </div>
)}

export default SideBarBodyContentItem;