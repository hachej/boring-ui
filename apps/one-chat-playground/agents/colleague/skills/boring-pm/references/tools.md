# Tool choices — optional support for the skill

Use a tool when it gives the expert a better way to explain, inspect, correct, or try the product. The skill's interviewing and specification workflow must work before adding external integrations. This is a proposed capability strategy, not a statement that these tools are installed in Boring PM.

| User moment | Needed capability | First choice | Optional addition |
| --- | --- | --- | --- |
| Resume with the right level of detail | Retrieve and correct this participant's profile and session state | Private project files with participant IDs and revisions | Authorized host profile storage for reuse across projects |
| Explain a real task | Conversation and targeted questions | Chat; installed Boring UI `ask_user` where useful | Consented transcription for an actual voice workflow |
| Show how the work happens | Read supplied documents, screenshots, and examples | Host file tools and suitable parsers | Scoped access to the user's existing document system |
| Check the agent's understanding | Editable evidence, rules, and brief | Workspace Markdown/JSON and file views | Craft as an expert-facing shared document |
| Understand a proposed solution | Workflow sketch or concrete example | A small diagram or workbench artifact | Canva for a storyboard or stakeholder explanation |
| Refine detailed interaction | Inspect and manipulate a prototype | Small Boring UI prototype | Figma when precise design collaboration is needed |
| Turn decisions into software | Code, execution, tests, and preview | Host coding and runtime tools | GitHub for the chosen source destination |
| Try and retain the product | Task trial, persistent results, access | Actual product runtime and explicit delivery record | Deployment and outcome tools appropriate to that product |

Use [the profile](user-profile.md) to choose a representation the person can inspect, and [solution exploration](solution-exploration.md) to compare alternatives before selecting an integration. A host's profile store must support the right person/scope, correction, and controlled reuse. This skill provides the data format and workflow, not an implemented profile service or automatic cross-session memory.

**Canva:** its official MCP documentation describes design creation/editing, discovery, exports, and collaboration [S23](sources.md#s23). Use it when a visual explanation helps the expert react to an idea. Recheck client-exposed tools, plan requirements, and editing access [S24](sources.md#s24). A storyboard is not a functioning product.

**Craft:** its documented MCP/API surfaces support working with documents and collections [S25](sources.md#s25), [S26](sources.md#s26). It can host a living brief if the expert wants to work there. Choose which artifact is authoritative, preserve source/requirement IDs, and detect concurrent edits before synchronizing. Do not create two conflicting masters or require Craft to finish an interview.

**Figma:** its official tools expose design context, screenshots, and component mappings [S27](sources.md#s27). Use it for a specific design collaboration need. Adapting that design to Boring UI and verifying the result remains implementation work.

For any external tool, first establish that the operation is available in the actual host and connection. A provider's API documentation, or an app connected in this conversation, does not make the capability available in a future Boring PM deployment. Tool discovery, authentication, and a Boring UI adapter may still be required.

Preserve project state and offer the best supported artifact if an optional integration is absent. Before an external write, carry forward existing authorization and confirm only missing consequential choices. Do not publish expert interviews merely because the reusable skill lives in a public repository.
