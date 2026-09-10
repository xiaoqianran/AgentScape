export class AgentScapeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AgentScapeError';
    this.code = code;
    this.details = details;
  }
}
