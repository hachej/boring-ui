ere's your monthly reminder that you shouldn't be prompting coding agents anymore. You should be designing loops that prompt your agents. I don't know about y'all, but this memo didn't make
0:08
8 seconds
it to me. Of course, I've seen loops before. Things like the Ralph loop really helped me think about how agents can do more over time, but it also massively increased the error rate of
0:17
17 seconds
the changes that I was having my agents make. They were really cool, but they didn't seem that productive. And I found myself going back to the usual, which was asking the model to make a plan,
0:26
26 seconds
reading the plan, saying, "Yeah, that looks good. go do this part and then the next part, then the next part, then having another agent review it, then bringing the feedback back to the first
0:33
33 seconds
agent and just the usual looping of work, but I was the one running the loop. I was the one doing the handholding and bringing things from
0:40
40 seconds
part one to part two and making sure all of my agents had the context they needed to build well. And Pete, as always, is a bit ahead of the curve. I have been a
0:48
48 seconds
huge fan of him since way before the open claw chaos because he knew how to think about building with agents in a fundamentally different way that made
0:56
56 seconds
him way more productive. I think of Pete as an experimental figure in many ways where rather than being the role model we should all be copying, he's the
1:04
1 minute, 4 seconds
person figuring out what the future looks like in a weird jank duct tape version now and we can all learn from that and see where things are going. At
1:12
1 minute, 12 seconds
least that's how I used to think about him and honestly I'll admit I still do in a lot of ways. But then I started building more with loops. I started getting my agents to prompt themselves.
1:21
1 minute, 21 seconds
I started setting up systems where agents would review code, give feedback, adjust it, and then trigger re-reviews.
1:26
1 minute, 26 seconds
I started building systems that would watch poll requests and watch existing issues on other repos to tell me when updates happen. I started using Hermes
1:34
1 minute, 34 seconds
agent to bring context to me instead of to go out and find it for me. And I've accepted now that Pete's right. We should still be writing prompts, though.
1:44
1 minute, 44 seconds
More importantly, I would argue now that the majority of your agent runs should probably not be running with prompts that you wrote. That is a crazy thing
1:52
1 minute, 52 seconds
for me to say because it was one of those like I never thought I would see the day things. But now that I've explored it myself and I've shipped a lot of code using these types of loops,
2:01
2 minutes, 1 second
I have a lot of thoughts I want to share. But I have one other thing I want to share quickly first, which is today's sponsor. AI should be good at design. It
2:08
2 minutes, 8 seconds
knows all the things it needs to about code, designs, visuals, and more. But every time I try to have it redesign things that I'm working on, it just doesn't do it right. At least that was
2:16
2 minutes, 16 seconds
my experience before I started using today's sponsor, Magic Patterns. These guys really cracked good design flows with AI. They're not trying to replace
2:24
2 minutes, 24 seconds
your whole stack or be a full site generator. They're trying to work within the real constraints of your real codebase on just the front end in order to get great designs out. The first
2:32
2 minutes, 32 seconds
thing that makes them different is the design system selector. Unlike other tools that will just generate a bunch of slop code, you can pick between existing
2:40
2 minutes, 40 seconds
realbased systems like the one that they provide, a wireframe system, or even classics like Shaden, Shakra, Mantine, and MUI. Or you can create your own, and
2:48
2 minutes, 48 seconds
you can also import things from Figma 2, which is super helpful. You can then switch between different models, obviously, the ones that we all love and know are decent design, like the Opus
2:56
2 minutes, 56 seconds
line, Gemini 31, but also their auto router has really impressed me. It was able to grab the real SVGs for the logos for the things that I wanted to put on there once I showed them where they
3:04
3 minutes, 4 seconds
were. I can open up the preview and send this to other people on my team, which has already been super helpful. I can also leave comments on any point on the
3:11
3 minutes, 11 seconds
screen to tell the agent what else I wanted to fix, which has been a lifesaver when you're working on these types of things. They even have a visual editor for when you want to edit fonts,
3:20
3 minutes, 20 seconds
content, and things yourself. So, when you notice the agent's just not getting something right, don't fight it. Change it yourself. This is a small thing, but it's one of my favorites. The ability to
3:28
3 minutes, 28 seconds
choose different frames to test your site in to see how it looks on like a mobile display or an iPad display is so helpful as you're trying to get these
3:37
3 minutes, 37 seconds
fine-tuned pieces right. I can't tell you how many times I had a design that seemed good, but as soon as I shipped it and opened it on my phone, it was awful.
3:43
3 minutes, 43 seconds
No more. Just do it here. Starting to see why companies like Door Dash, Vappy, Granola, and more are leaning so hard on what Magic Patterns has built? These
3:51
3 minutes, 51 seconds
guys get it. Design better with AI at soy.link/magicpatterns.
3:55
3 minutes, 55 seconds
So, this post by Pete is the one that started this new era of looping discourse. But this is not the tweet that got me to go try loops. It was this
4:04
4 minutes, 4 seconds
one. Here's a simple loop. Tell Codeex to maintain your repos. Wake up every 5 minutes and direct work to threads. That
4:12
4 minutes, 12 seconds
makes it easy to parallelize and steer work as needed. He uses an orchestrator skill combined with his triaging and auto review and computer use skills so
4:20
4 minutes, 20 seconds
some work can land autonomously. This helped a lot click for me in particular of your agent directing work to threads.
4:30
4 minutes, 30 seconds
I didn't realize Codeex had a feature where a thread in Codeex could spin up another thread in Codeex. And now that I
4:37
4 minutes, 37 seconds
know it has that, I have been pushing it much harder. I want to contextualize this in a bit of a weird way. I'm going to reference the article Anthropic did
4:45
4 minutes, 45 seconds
about recursive self-improvement because they did a great job describing how our work has changed over time. Previously, a person would use a computer and they
4:54
4 minutes, 54 seconds
eventually would use that to build a chatbot or an AI model. Once we had the AI model, the person could use the computer to ask the chatbot questions
5:02
5 minutes, 2 seconds
and get outputs that they could then use in their code to make better software and eventually maybe make a better model, too. But the loop was the person
5:11
5 minutes, 11 seconds
uses the computer asks the chatbot a question. It gives a result to the person who then copy paste it into their code and then asks another question. I
5:18
5 minutes, 18 seconds
know a lot of people use stuff like my chat service T3 chat as a way to just do code but they would bring it code questions and then copy paste the
5:26
5 minutes, 26 seconds
answers. It really kind of emphasized the whole like coding is just copy paste meme. Chat bots pushed it way further but now we've gone far beyond that
5:33
5 minutes, 33 seconds
because copyping is not the best use of our time. So instead of copy pasting the result from the chatbot into our codebase, we started to just use our
5:40
5 minutes, 40 seconds
IDEs, our terminals and other tools to talk to the model and get it to edit the code directly and that's where things have been for a while now. But then we
5:47
5 minutes, 47 seconds
had another big change with workflows and sub aents. I know a lot of people haven't even made this move yet and I was hesitant to do it myself. Obviously,
5:56
5 minutes, 56 seconds
tools like Cloud Code and Cursor will do some amount of this to go explore and find things in your codebase, but the idea of telling my agent to spin up five
6:05
6 minutes, 5 seconds
agents to go break up work was something I just wasn't that interested in, especially when I saw all the crazy [ __ ] people were doing, trying to create
6:13
6 minutes, 13 seconds
different personas and roles for all of those workers where they had a skill that wrote down in markdown files, this is the adversarial reviewer, this is the
6:21
6 minutes, 21 seconds
security reviewer, this is the groer and finder, this is the exploration agent that made no [ __ ] sense. And I would argue that still makes no [ __ ] sense.
6:30
6 minutes, 30 seconds
The idea of predefining personas to go do things in your codebase fundamentally misses the cool part of agents and AI as
6:38
6 minutes, 38 seconds
a whole. It's dynamic. The agent can build the context it needs and do the things it needs to without having
6:45
6 minutes, 45 seconds
everything pre-built and hardcoded ahead of time. Imagine a coding template for a project where every file is already created and you have to edit things in
6:53
6 minutes, 53 seconds
the existing files. It's stupid. And that's how I felt about most of the sub aent stuff that people were doing.
7:00
7 minutes
Workflows pushed me hard here. And the video I just recently published about the things I like about cloud code goes a little more in depth there on the
7:07
7 minutes, 7 seconds
things I like about workflows. The idea of your agents constructing this method that they're going to use to tackle a problem was really enticing to me. But
7:16
7 minutes, 16 seconds
now I'm going a bit further. Closing the loop where the model doesn't just pick and spin up what sub aents it needs. It
7:23
7 minutes, 23 seconds
audits the work it does and then sends the result back to run again and again and again and again. I am not at the
7:32
7 minutes, 32 seconds
fully autonomous loop point yet. I am not claiming the same things people like Boris are claiming where they're writing the loop and now the code is just happening by itself with no oversight.
7:43
7 minutes, 43 seconds
That is stupid. But I wanted a taste. I wanted to get an idea of how this could work so I could play with it myself and
7:52
7 minutes, 52 seconds
see what benefits exist. So I started to play a bit. I started to do stuff like this. I had Claude Code spin up a PR for
8:01
8 minutes, 1 second
a pretty big refactor. I used sub agents a bunch to go address specific concerns and take over specific parts of the codebase. I didn't even say how to break
8:08
8 minutes, 8 seconds
it up. I let Opus figure that out itself. Man, I miss mythos right now.
8:12
8 minutes, 12 seconds
But one specific thing I did do was tell the agent to monitor the PR for comments because I have a lot of awesome code
8:21
8 minutes, 21 seconds
review tools that are watching my PRs when they're filed and leaving feedback.
8:26
8 minutes, 26 seconds
And I moved away from copy pasting code out of chat bots and into my codebase.
8:30
8 minutes, 30 seconds
And instead I found myself copy pasting the comments that things like code rabbit reptile and macroscope would leave and pasting those into the agent
8:39
8 minutes, 39 seconds
so that it would go address them. It wasn't great. So what I started doing instead, and this was the first step into heavier looping for me, and I would
8:47
8 minutes, 47 seconds
highly recommend you guys try the same because it's actually really cool. Once you have your setup in such a way where you have different work trees that are monitoring and working around specific
8:56
8 minutes, 56 seconds
pieces of work where this code is in a directory that is specific to this PR, that means I don't care about this directory. It's not blocking other work.
9:04
9 minutes, 4 seconds
Once you have this broken out, in this case I'm sating to another machine on my network that is running this codebase that has this fork of this codebase,
9:12
9 minutes, 12 seconds
this work tree for it and then I told it monitor the comments, watch the PR, wait for comments to come in and when they
9:20
9 minutes, 20 seconds
come in address them and it did it and it's been doing it now for like 6 plus
9:27
9 minutes, 27 seconds
hours. It has made a ton of improvements through this. And then I had a taste and then I got really excited to play more.
9:35
9 minutes, 35 seconds
I wanted to push the limits of how much I could land without having to do the follow-up prompting myself. And I'll be
9:44
9 minutes, 44 seconds
honest, I still found myself hopping over the codeex and saying, "Hey, can you review this code?" And then copy pasting the result of that review over.
9:51
9 minutes, 51 seconds
I played a little bit more there where I told Claude, hey, when you're done, run codeex with this command to get it to give feedback and then address what it
9:59
9 minutes, 59 seconds
gives as feedback. And that worked pretty well, too. But this is still for traditional work where I have one PR that does one thing that is being
10:08
10 minutes, 8 seconds
watched by my agent to address the comments that come in. There's a lot of work that can't be broken down into just
10:15
10 minutes, 15 seconds
one PR. I recently ran into one of those pieces of work. I have been rebuilding the isolate layer inside of Lakebed to
10:23
10 minutes, 23 seconds
make it a little more financially reasonable to deploy the way I want to deploy it. I did a deep dive on performance and alternative runtime
10:32
10 minutes, 32 seconds
options for how we could architect this with 55 and it had really good suggestions, but one of the things it pointed out was that my data
10:39
10 minutes, 39 seconds
architecture had a lot of room to improve that could help performance even more than runtime changes. Here's where it gave that feedback. The isolate
10:48
10 minutes, 48 seconds
architecture may not be the first scaling bottleneck. Current subscription validations rerun every query subscription for an app after each mutation. For hot apps, we should
10:56
10 minutes, 56 seconds
implement dependency aware invalidation, mutation coalescing, per app invalidating batches, shared results for identical subscription arguments, and
11:03
11 minutes, 3 seconds
back pressure and maximum refresh frequency. This is when I realized there was a lot of work that needed to be done. So I asked up front from these
11:11
11 minutes, 11 seconds
features you think we should implement, which should be done separately and which should be done in tandem. Would it be realistic to do all of this in one
11:18
11 minutes, 18 seconds
PR? It very quickly said, "No, I would not implement all of this. It's one project, but at least three PRs, current implementation synchronously, yada
11:25
11 minutes, 25 seconds
yada." And then it broke up what the different PRs could look like. I asked if they could be worked on separately or should they be stacked. It said they should be mostly stacked, but there's
11:34
11 minutes, 34 seconds
some opportunity for parallelizing. I then told it to write an HTML plan. My beloved, thank you again to our friend
11:41
11 minutes, 41 seconds
Thoric for introducing me to this wonderful pattern where it is so much easier to see what my agents want to do and read it in a way that I can even
11:48
11 minutes, 48 seconds
open on my phone. It's so nice. And it wrote these plans for each of the portions that it needed to complete. I
11:55
11 minutes, 55 seconds
also told it here after the plan like please make the plans piece to create a new thread with the first plan as a starting point. And it did. It created a
12:04
12 minutes, 4 seconds
PR by itself in a new thread to go implement that first plan and then it landed and I did my usual thing where I
12:13
12 minutes, 13 seconds
had a bunch of back and forth review. I spun up another thread to review it. I copy pasted back and forth. It got into a good state so I merged it. I then
12:21
12 minutes, 21 seconds
asked to make a fresh thread for part two which it did. It only took a few seconds but I realized I should be looping harder. This is the single
12:29
12 minutes, 29 seconds
message I have sent to an agent that has impacted my psychosis the most. Would it be possible to make a workflow of some form that first will spin up a separate
12:37
12 minutes, 37 seconds
thread to make the PR, second, spin up another thread to review that PR when it's filed. Three, puts the thread from
12:44
12 minutes, 44 seconds
one in a loop reviewing comments until it gets all approvals. And then fourth, the thread would merge the PR and trigger another one for the next piece.
12:53
12 minutes, 53 seconds
I didn't think it'd be able to do this, but I was curious how it would try. And it made a kind of broken diagram showing
13:00
13 minutes
the workflow it had in mind. It said it would use a heartbeat attached to this thread pulling every 5 to 10 minutes. On each wake up, it would read the implementation thread status, detect
13:09
13 minutes, 9 seconds
file PRs, create a fresh review thread when a new PR has a new Shaw head, send actionable findings back, re-review
13:16
13 minutes, 16 seconds
after the fixes are pushed, yada yada, and then pull latest main before creating the next work tree. So, I said make the workflow and use it to file the
13:24
13 minutes, 24 seconds
remaining PRs. And it did it. This was Sunday at 2:29 a.m. and it eventually finished and broke everything in my editor pretty aggressively at 6:50 a.m.
13:35
13 minutes, 35 seconds
I set this off before going to bed and I woke up the next day with four stacked PRs reviewed to hell and back all
13:44
13 minutes, 44 seconds
merged. It was [ __ ] awesome. Do I think you should do this on real production code bases that have millions of users? Probably not. At least not
13:53
13 minutes, 53 seconds
yet. But god damn is it cool to spin up work in this way where complex multi-stage problems that need their own
14:02
14 minutes, 2 seconds
breakdowns that need their own poll requests that need their own reviews and cycles and loops because that's the craziest thing here. I asked the model
14:10
14 minutes, 10 seconds
if I could make this loop and it made a loop that makes sub loops dynamically.
14:16
14 minutes, 16 seconds
This isn't a hard-coded every time I make a change I spin up one reviewer that reviews it and then they go back and forth. This is a dynamic workflow
14:25
14 minutes, 25 seconds
that was created based on the specific needs of this specific problem I was solving. My loops created loops and they
14:33
14 minutes, 33 seconds
did a great job at it. This was real code that landed and sadly I couldn't have Fable come in and review it because
14:39
14 minutes, 39 seconds
this was after the ban. But the idea of your agents being able to orchestrate dynamic work in a way that is
14:46
14 minutes, 46 seconds
specifically tailored to the problem is so cool. Throughout most of my career, when I worked at real companies, we would follow some form of the
14:55
14 minutes, 55 seconds
traditional agile sprint loop where we would put tickets inside of our backlog and then once every week or two weeks,
15:04
15 minutes, 4 seconds
the start of the week, we would pull up the backlog and decide what was worth working on and how long we thought it would take and then try to make sure
15:12
15 minutes, 12 seconds
work that's blocking other work was prioritized accordingly, that everybody had unblocked work to do. But the actual flow of all of this was pretty static.
15:20
15 minutes, 20 seconds
It was the classic agile waterfally structure and we kind of had to force our work to fit that shape. The most
15:28
15 minutes, 28 seconds
productive teams were the ones that would build their own alternative shape around the problems they were trying to solve. That is what makes this so cool.
15:37
15 minutes, 37 seconds
The shape of the loop, the shape of the structure, the shape of how work happens can be dynamically generated based on the shape of the work that you're doing.
15:49
15 minutes, 49 seconds
And you can use this for all sorts of crazy stuff. You can use this to monitor poll requests that need to be merged.
15:56
15 minutes, 56 seconds
You can use this on a schedule to every morning start your day with feedback on what PRs are worth merging and what ones are worth forgetting about. I use this
16:04
16 minutes, 4 seconds
type of thinking to find the best solution for a 5G hotspot. And since I had a loop checking what the best deals were, I got early information about the new Verizon plan they just put out
16:13
16 minutes, 13 seconds
because my loop pointed it out to me randomly on Discord. It's so cool. And again, to my earlier point, I wrote a
16:20
16 minutes, 20 seconds
handful of prompts in this thread. I wrote most of the prompts. Actually, no, I didn't cuz it got in that schedule after. But up until the schedule
16:28
16 minutes, 28 seconds
started, I wrote all the prompts and I read the responses and I said, "Yeah, that sounds good. Let's see what happens." And then I did see what
16:36
16 minutes, 36 seconds
happened. And what happened was kind of [ __ ] awesome. So, what I would highly recommend you do here, the info you take from here, is to think about the work
16:45
16 minutes, 45 seconds
you do before, during, and after you prompt your agent. When your agent completes its task, pay attention to
16:52
16 minutes, 52 seconds
what you do next. For me, what would happen is I would tell the agent to build the thing and then once it built it, I would run the thing and go see if
17:01
17 minutes, 1 second
it worked. And if it did, I would commit the thing and then push the thing and then make a pull request on GitHub for the thing. I would then wait for my code
17:09
17 minutes, 9 seconds
review agents to give feedback. I would address that feedback. I would then ask my team for feedback. I would address that feedback and then I would merge it.
17:17
17 minutes, 17 seconds
Start from where you started there. The first thing I did after the changes were completed was run a dev server. Tell the
17:24
17 minutes, 24 seconds
agent to do that. I then checked if the work worked. Tell the agent to do that, too. Computer use has gotten really good. After I verified the work, I would
17:33
17 minutes, 33 seconds
then commit. Tell the agent to do that once it's verified things are correct.
17:36
17 minutes, 36 seconds
Tell it to push up the code and file a PR once it's ready. Then I would go get those code review comments and copy paste them into the agent to fix. Tell
17:44
17 minutes, 44 seconds
the agent to do that itself, too. Maybe tell the agent to spin up other threads to do its own reviews. The other spicier way of putting this is that we are
17:53
17 minutes, 53 seconds
looking at the code too early. If you are reading the code your agent put out before another agent read it and gave feedback on it, you're wasting your own
18:02
18 minutes, 2 seconds
time. That's time that the agent could have spent instead that you could have used to find other work worth doing or to relax a little or go spin up a side
18:10
18 minutes, 10 seconds
project. I don't know what you're going to do with your free time, but I have had far too many instances where I read agent code. was like, "That's obviously wrong." And then told it to go fix it.
18:18
18 minutes, 18 seconds
They can figure that [ __ ] out themselves, too. And now when the human comes in, all the [ __ ] is gone and you can focus on the hard stuff. It's so
18:26
18 minutes, 26 seconds
much more fun. Try to find where you have to be involved and see what it takes to prompt yourself out of it. I'm not saying you need a bunch of custom
18:34
18 minutes, 34 seconds
skills. I have almost none here. I'm not saying that you need to build fancy plugins or install a bunch of [ __ ] I'm just using stock codecs. I'm not even
18:41
18 minutes, 41 seconds
using T3 Code for this. I do hope to get these features added to T3 code soon cuz they're really cool, but I'm just using stock codecs with a normal account here.
18:48
18 minutes, 48 seconds
There is one catch though, cost. You will burn many more tokens when you run
18:55
18 minutes, 55 seconds
things in loops like this. And if it's going down the wrong path, it might go down that wrong path for longer to burn more tokens and potentially cost you
19:03
19 minutes, 3 seconds
more money. If you're paying API prices, you probably shouldn't be doing loops yet. That said, you might be surprised
19:10
19 minutes, 10 seconds
how far you can go with them. Remember that loop I mentioned earlier that I was using Opus and Claude code for where it's watching the PR and updating it
19:19
19 minutes, 19 seconds
constantly? Not only is it doing that, I've noticed that every time it gets feedback, it spins up a workflow with
19:26
19 minutes, 26 seconds
eight steps or more to address all of it. I had one agent spend under 10 minutes leaving feedback. And based on
19:33
19 minutes, 33 seconds
that feedback, the Opus workflow ran for eight hours and did over three million tokens down to address like three small comments. It was brutal. It was absurd.
19:44
19 minutes, 44 seconds
If I was blocked during that time, it would have been very rough. And honestly, I was kind of blocked at that point because this is a big overhaul and I want this in before doing other
19:51
19 minutes, 51 seconds
changes cuz I'm unfucking the the TypeScript that looks like Python that GPT 5.5 wrote. Because as great as the
19:59
19 minutes, 59 seconds
model is at writing code that functions, it does not write code I like looking at. Anthroic models write better-looking code. I wanted to do this with Fable.
20:06
20 minutes, 6 seconds
Fable was taken. So instead, I burned a shitload of Opus tokens. This thread is so long that it's like breaking my SSH
20:13
20 minutes, 13 seconds
and clawed code. I can't even scroll up far enough to get to my first prompt because this thread is just so much [ __ ] going on. Very little of which has
20:21
20 minutes, 21 seconds
involved me at all. So, how was my usage? I do have two Claude code accounts right now, so I'm sure this burned through it really aggressively,
20:29
20 minutes, 29 seconds
right? Well, this combined with everything else I have been working on for the last few days using Opus, still
20:36
20 minutes, 36 seconds
has me at only 29% of my weekly limit, which expires in 8 hours. I was maxing
20:43
20 minutes, 43 seconds
out my limits with Fable. And with Opus in a loop like this, I'm not even close to getting my limits. And I've had like
20:51
20 minutes, 51 seconds
five of these types of loops running in that time. Really big piles of changes happening. And it doesn't [ __ ] matter. It's not getting close to my
21:00
21 minutes
limits. I am on the $200 plan. I will also say that I ran a workflow using the new Claude code with Opus48 when it came
21:07
21 minutes, 7 seconds
out on the $100 plan and I hit the five hour limit instantaneously. I have never come close to the five hour limit with
21:14
21 minutes, 14 seconds
Opus and Loops. And I'm also not coming close to the weekly limit with it either on that $200 plan. So if you're already on a $200 plan or you're willing to be
21:23
21 minutes, 23 seconds
on one and you find that your usage is not getting like lethal, like you're not getting close to maxing out, start
21:30
21 minutes, 30 seconds
looping more. And since you can't use these plans at normal companies usually because of the differences in restrictions in how you're supposed to use an enterprise plan at API prices, go
21:39
21 minutes, 39 seconds
use this for crazy [ __ ] that you don't think should be possible. I would also recommend experimenting with the tools that are included with our harnesses now. A lot of them are pretty powerful.
21:48
21 minutes, 48 seconds
Codex's ability to spin up new threads is really, really cool. Both Codeex and Claude Code have a /goal primitive which
21:56
21 minutes, 56 seconds
allows you to get one thread going forever on a task where it keeps double-checking at the end of a turn, did you finish the work? If no, okay,
22:04
22 minutes, 4 seconds
keep going. That type of like linear neverending loop is different from a dynamic workflow like I showed earlier
22:10
22 minutes, 10 seconds
where it creates dynamic work based on a pre-planned goal versus a traditional/goal where it just keeps
22:19
22 minutes, 19 seconds
plugging along on that one thread until it completes. I have a goal running right now that's over 12 hours in that's trying to rewrite Hermes agent in Rust
22:27
22 minutes, 27 seconds
so that I can run it in isolates that are much smaller and use less resources cuz my Hermes agent uses over a gig of RAM. It is getting close. It'll probably
22:34
22 minutes, 34 seconds
work. It probably won't be production ready. It probably won't be something I want to put out there and sell or anything, but it's a fun use of my spare tokens. And it's really interesting to
22:42
22 minutes, 42 seconds
see what types of problems can be solved when you throw these crazy rate limits at them. The point I'm trying to make here is that you should be treating
22:50
22 minutes, 50 seconds
these limits like challenges. If you're on the expensive plan, you should be trying to get close to maxing it out because that's just money you're losing
22:57
22 minutes, 57 seconds
if you're not. The 70% I'm not going to hit in my weekly limit here at 8 hours is thousands of dollars of inference
23:05
23 minutes, 5 seconds
that I paid for that I could have done that I didn't do. But again, I need to be realistic with you guys. In all of
23:13
23 minutes, 13 seconds
May on this computer, I did about $1900 of inference. I didn't pay that obviously cuz I'm using the
23:20
23 minutes, 20 seconds
subscriptions with Cloud Code and Codeex. But this month, June, which we're only 17 days into, I'm at nearly
23:27
23 minutes, 27 seconds
$6,000 of usage. But that's just this computer.
23:32
23 minutes, 32 seconds
As I mentioned earlier, I'm using multiple computers. My Mac Mini has another $2,600
23:40
23 minutes, 40 seconds
of inference on it. I'm at 10 grand for the month across all of my machines. And that's on three of those $200 plans. Two
23:48
23 minutes, 48 seconds
Cloud Code one codecs. And I haven't used the second Claude code account since Fable was taken from us. That's a shitload of value that I'm getting given
23:56
23 minutes, 56 seconds
for relatively cheaply. To spend $600 and get back 10 grand of inference, that means you can do a lot. And if you're
24:04
24 minutes, 4 seconds
not pushing loops to their limits, you're not using that as much as you could be. I've been having way more fun with loops than I expected to. And I'm curious if you guys will as well. Take a
24:13
24 minutes, 13 seconds
look at what you do when you're done prompting. see what additional steps you take and ask the model, can you do this?
24:20
24 minutes, 20 seconds
You might be surprised at what it's capable of. I know for a fact that I was very surprised myself. What I'm trying to say here is that loops are cool, not because the technology or the mindset's
24:28
24 minutes, 28 seconds
really cool, but the idea of letting agents do more is unbelievably powerful.
24:33
24 minutes, 33 seconds
You take anything from this video, it really should be that. Ask your agent to do the next step and see if it impresses you. I know it impressed me. Let me know
24:41
24 minutes, 41 seconds
how it goes. And until next time, peace nerds.