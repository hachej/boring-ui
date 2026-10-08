// @hachej/boring-feedback/tickets (FEEDBACK.md, "Tickets"), server only: a ticket is a Markdown file the assistant writes under `tickets/` with
// Pi's own file tools; `createTicketSinks(...).mirror(path)`, called by the host when a write creates one, publishes it once to the first
// sink that accepts the project and writes the outcome back into its front matter. Imports `@hachej/boring-files` contracts (type-only) and nothing else.
export { parseTicket, withTicketOutcome, createTicketSinks } from './ticket.js';
export type { ProjectInfo, ProjectRepo, Ticket, TicketSink, TicketSinkContext, TicketSinkResult, TicketOutcome, ParsedTicket, TicketSinkOptions, TicketSinks, TicketMirrorResult } from './ticket.js';
export { githubSink, fileSink, ticketRepoOf, GITHUB_API } from './sinks.js';
export type { GithubSinkOptions, FileSinkOptions } from './sinks.js';
