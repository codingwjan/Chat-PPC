import "./widget.css";
import "./App.js"

const VotingWidget = ({votingPollData}) => {

    let votingOptionLeft = document.getElementById(votingPollData.uuid1);
    let votingOptionRight = document.getElementById(votingPollData.uuid2);

        if(localStorage.getItem(votingPollData.uuid1) === "voted"){
            //wait for the page to load
            setTimeout(() => {
                OptionLeft();
            }, 1000);
        } else if(localStorage.getItem(votingPollData.uuid2) === "voted"){
            //wait for the page to load
            setTimeout(() => {
                OptionRight();
            }, 1000);
        }




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
                            <div id={votingPollData.uuid1+"count"} className="votingOptionVoteButtonDescription">Votes show after click   </div>
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
                            <div id={votingPollData.uuid2+"count"} className="votingOptionVoteButtonDescription">Votes show after click</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    function clickOptionLeft() {
        votingPollData.socket.emit("voteLeft", votingPollData.uuid1);
        OptionLeft();
    }

    function clickOptionRight() {
        votingPollData.socket.emit("voteRight", votingPollData.uuid2);
        OptionRight();
    }


    function OptionLeft() {

        //make the text and the check mark green
        votingOptionLeft.style.color = "green";


        document.getElementById(votingPollData.uuid1+"count").innerHTML = "Votes: " + votingPollData.resultone;
        document.getElementById(votingPollData.uuid2+"count").innerHTML = "Votes: " + votingPollData.resulttwo;

        //make the other text unclickable
        votingOptionRight.style.pointerEvents = "none";
        //cursor: not-allowed;
        votingOptionRight.style.cursor = "not-allowed";
        votingOptionLeft.style.boxShadow = "0 0 10px #0081F5";

        //save the vote in local storage
        localStorage.setItem(votingPollData.uuid1, "voted");
        localStorage.setItem(votingPollData.uuid2, "notvoted");
        
    }

    function OptionRight() {
        //make the text and the check mark green
        votingOptionRight.style.color = "green";
        //display the other text unclickable
        votingOptionLeft.style.pointerEvents = "none";
        //cursor: not-allowed;
        votingOptionLeft.style.cursor = "not-allowed";
        //give the box a blue glow
        votingOptionRight.style.boxShadow = "0 0 10px #0081F5";


        document.getElementById(votingPollData.uuid1+"count").innerHTML = "Votes: " + votingPollData.resultone;
        document.getElementById(votingPollData.uuid2+"count").innerHTML = "Votes: " + votingPollData.resulttwo;

        //save the vote in local storage
        localStorage.setItem(votingPollData.uuid1, "notvoted");
        localStorage.setItem(votingPollData.uuid2, "voted");

    }
}

export default VotingWidget;