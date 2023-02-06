import react from "react";
import "./widget.css";

const VotingWidget = ({votingPollData}) => {
    let votingOptionLeft = document.getElementById(votingPollData.uuid1);
    let votingOptionRight = document.getElementById(votingPollData.uuid2);
    return (
        <div className="votingWidget">
            <div className="votingWidgetTop">
                <div className="votingWidgetTopLeft">
                    <div className="votingWidgetTopLeftTitle">{votingPollData.message}</div>
                    <div className="votingWidgetTopLeftDescription">{votingPollData.username}</div>
                </div>
                <div className="votingWidgetTopRight">
                    <div className="votingWidgetTopRightTime">{votingPollData.time}</div>
                </div>
            </div>
            <div className="votingWidgetBottom">
                <div className="votingOptions">
                    <div id={votingPollData.uuid1} className="votingOptionLeft" onClick={clickOptionLeft}>
                        <div id={votingPollData.uuid1} className="votingOptionTitle">{votingPollData.optionone}</div>
                        <div className="votingOptionVoteButton">
                            <svg xmlns="http://www.w3.org/2000/svg"
                                 className="icon icon-tabler icon-tabler-circle-check" width="24" height="24"
                                 viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none"
                                 stroke-linecap="round" stroke-linejoin="round">
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                                <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path>
                                <path d="M9 12l2 2l4 -4"></path>
                            </svg>
                        </div>
                    </div>
                    <div id={votingPollData.uuid2} className="votingOptionRight" onClick={clickOptionRight}>
                        <div id={votingPollData.uuid2} className="votingOptionTitle">{votingPollData.optiontwo}</div>
                        <div className="votingOptionVoteDescription">
                            <svg xmlns="http://www.w3.org/2000/svg"
                                 className="icon icon-tabler icon-tabler-circle-check" width="24" height="24"
                                 viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none"
                                 stroke-linecap="round" stroke-linejoin="round">
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                                <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path>
                                <path d="M9 12l2 2l4 -4"></path>
                            </svg>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    function clickOptionLeft() {
        //make the text and the check mark green
        votingOptionLeft.style.color = "green";

        //make the other text unclickable
        votingOptionRight.style.pointerEvents = "none";
        //cursor: not-allowed;
        votingOptionRight.style.cursor = "not-allowed";
        
    }

    function clickOptionRight() {
        //make the text and the check mark green
        votingOptionRight.style.color = "green";
        //display the other text unclickable
        votingOptionLeft.style.pointerEvents = "none";
        //cursor: not-allowed;
        votingOptionLeft.style.cursor = "not-allowed";
    }
}

export default VotingWidget;