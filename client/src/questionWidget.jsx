import react from "react";
import "./questionWidget.css";
import {json} from "react-router-dom";
let answer;
const QuestionWidget = ({questionWidgetData}) => {
  return (
    <div className="questionWidget">
        <div className="questionWidgetTop">
            <div className="questionWidgetTopLeft">
                <div className="questionWidgetTopLeftTitle">{questionWidgetData.message}</div>
                <div className="questionWidgetTopLeftDescription">{questionWidgetData.username}</div>
            </div>

            <div className="questionWidgetTopRight">
                <div className="votingWidgetTopRight">
                    <div className="votingWidgetTopRightTime">{questionWidgetData.time}</div>
                </div>
            </div>
        </div>
                <div className="votingWidgetBottom">
                <input
                    className="votingWidgetBottomInput"
                    placeholder="Give your opinion"
                    onChange={(e) => {
                        answer = e.target.value;
                    }}
                    type="text"
                    />
                    <button className="votingWidgetBottomButton" onClick={submitAnswer}>Submit</button>
            </div>
    </div>
  );

    function submitAnswer() {
        if (answer === undefined || answer === "") {
            alert("Please enter an answer")
        } else {
            questionWidgetData.socket.emit("answer", JSON.stringify({
                message: answer,
                questionId: questionWidgetData.uuid,
                username: localStorage.getItem("username")
            }));
        }
    }
};

export default QuestionWidget;