"use client";

import type { MessageDTO } from "@/lib/types";

interface ChatMessageProps {
  message: MessageDTO;
  answerDraft?: string;
  onAnswerDraftChange: (messageId: string, value: string) => void;
  onSubmitAnswer: (messageId: string) => void;
  onVote: (messageId: string, side: "left" | "right") => void;
  hasVoted: boolean;
}

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatMessage({
  message,
  answerDraft,
  onAnswerDraftChange,
  onSubmitAnswer,
  onVote,
  hasVoted,
}: ChatMessageProps) {
  if (message.type === "votingPoll") {
    return (
      <div className="votingWidget">
        <div className="votingWidgetTop">
          <div className="votingWidgetTopLeft">
            <div className="votingWidgetTopLeftTitle">{message.message}</div>
            <div className="votingWidgetTopLeftDescription">{message.username}</div>
          </div>
          <div className="votingWidgetTopRight">
            <div className="votingWidgetTopRightTime">{formatTime(message.createdAt)}</div>
          </div>
        </div>
        <div className="votingWidgetBottom">
          <div className="votingOptions">
            <button
              type="button"
              className={`votingOptionLeft${hasVoted ? " voted" : ""}`}
              onClick={() => onVote(message.id, "left")}
              disabled={hasVoted}
            >
              <div className="votingOptionTitle">{message.optionOne}</div>
              <div className="votingOptionVoteButtonDescription">Votes: {message.resultone || "0"}</div>
            </button>
            <button
              type="button"
              className={`votingOptionRight${hasVoted ? " voted" : ""}`}
              onClick={() => onVote(message.id, "right")}
              disabled={hasVoted}
            >
              <div className="votingOptionTitle">{message.optionTwo}</div>
              <div className="votingOptionVoteButtonDescription">Votes: {message.resulttwo || "0"}</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (message.type === "question") {
    return (
      <div className="questionWidget">
        <div className="questionWidgetTop">
          <div className="questionWidgetTopLeft">
            <div className="questionWidgetTopLeftTitle">{message.message}</div>
            <div className="questionWidgetTopLeftDescription">{message.username}</div>
          </div>
          <div className="questionWidgetTopRight">
            <div className="votingWidgetTopRightTime">{formatTime(message.createdAt)}</div>
          </div>
        </div>
        <div className="votingWidgetBottom">
          <input
            className="votingWidgetBottomInput"
            placeholder="Give your opinion"
            value={answerDraft || ""}
            data-answer-id={message.id}
            onChange={(event) => onAnswerDraftChange(message.id, event.target.value)}
            type="text"
          />
          <button className="votingWidgetBottomButton" onClick={() => onSubmitAnswer(message.id)}>
            Submit
          </button>
        </div>
      </div>
    );
  }

  if (message.type === "answer") {
    return (
      <div className="chatWindowBodyMessage">
        <div className="chatWindowBodyMessageLeft">
          <div className="userIconContainer">
            <img className="userIcon" src={message.profilePicture} alt="user icon" />
          </div>
          <div className="chatWindowBodyMessageRight">
            <div className="chatWindowBodyMessageRightTop">
              <div className="chatWindowBodyMessageUserName">{message.username}</div>
              <div className="chatWindowBodyMessageTime">{formatTime(message.createdAt)}</div>
            </div>
            <div className="chatWindowBodyMessageRightBottom">
              <div className="chatWindowBodyOriginalMessageText">
                &quot;{message.oldmessage}&quot; - {message.oldusername}
              </div>
              <div className="chatWindowBodyMessageText">{message.message}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chatWindowBodyMessage">
      <div className="chatWindowBodyMessageLeft">
        <div className="userIconContainer">
          <img className="userIcon" src={message.profilePicture} alt="user icon" />
        </div>
        <div className="chatWindowBodyMessageRight">
          <div className="chatWindowBodyMessageRightTop">
            <div className="chatWindowBodyMessageUserName">{message.username}</div>
            <div className="chatWindowBodyMessageTime">{formatTime(message.createdAt)}</div>
          </div>
          <div className="chatWindowBodyMessageRightBottom">
            <div className="chatWindowBodyMessageText">{message.message}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
