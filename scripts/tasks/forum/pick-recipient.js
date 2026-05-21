export function createPickRecipientTask(recipientQueue) {
  return {
    name: "forum:pick-recipient",
    async run({ state }) {
      if (recipientQueue.length === 0) {
        return {
          ...state,
          status: "queue_empty",
          abortPipeline: true
        };
      }

      const recipient = recipientQueue.shift();
      return {
        ...state,
        currentRecipient: recipient,
        status: "recipient_picked",
        abortPipeline: false
      };
    }
  };
}
