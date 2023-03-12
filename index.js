const { Toolkit } = require('actions-toolkit');
const core = require('@actions/core');
var JiraApi = require('jira-client');

// Run your GitHub Action!
Toolkit.run(async tools => {
  try {
    var jira = new JiraApi({
      protocol: 'https',
      host: core.getInput('jiraHost', { required: true }),
      username: core.getInput('jiraUsername', { required: true }),
      password: core.getInput('jiraPassword', { required: true }),
      apiVersion: '2',
      strictSSL: true
    });

    const event = process.env.GITHUB_EVENT_NAME;
    const payload = tools.context.payload;
    if (event == 'issues' && payload.action == 'opened') {
      await addJiraTicket(jira, tools);
    } else if (event == 'issues' && payload.action == 'labeled') {
      await addJiraLabel(jira, tools);
    } else if (event == 'issues' && payload.action == 'unlabeled') {
      await removeJiraLabel(jira, tools);
    } else if (event == 'issue_comment') {
      await addJiraComment(jira, tools);
    } else {
      tools.exit.failure(`Unknown event: ${event}`)
    }

    tools.exit.success('We did it!')
  } catch (e) {
    console.log(e);
    tools.exit.failure(e.message)
  }
});

async function addJiraLabel(jira, tools) {
  const payload = tools.context.payload;
  const label = payload.label.name;
  const request = { "update": { "labels": [{ "add": label }] } };
  const issueNumber = await getIssueNumber(tools);
  const result = await jira.updateIssue(issueNumber, request);
  console.log(result);
}

async function removeJiraLabel(jira, tools) {
  const payload = tools.context.payload;
  const label = payload.label.name;
  const request = { "update": { "labels": [{ "remove": label }] } };
  const issueNumber = await getIssueNumber(tools);
  const result = await jira.updateIssue(issueNumber, request);
  console.log(result);
}

async function getIssueNumber(tools) {
  const issueComment = (await tools.github.issues.listComments({
    owner: tools.context.repo.owner,
    repo: tools.context.repo.repo,
    issue_number: tools.context.issue.issue_number,
    per_page: 1
  })).data[0].body;

  const re = new RegExp(/Issue: (\w+\-\d+)/);
  let issue = issueComment.match(re);

  if (!issue || !issue[1]) {
    tools.exit.failure("Could not find ticket number in issue body");
  } else {
    issue = issue[1];
  }

  return issue;
}

async function addJiraComment(jira, tools) {
  tools.log.info("Adding a Jira comment");
  const payload = tools.context.payload;
  const comment = payload.comment;

  const mdPreamble = "\n\n---\n######"
  const issue = await getIssueNumber(tools);
  const body = `${comment.body}${mdPreamble}Comment by: ${comment.user.html_url} at ${comment.html_url}`;


  tools.log.pending(`Creating Jira comment for issue ${issue} with the following content:`);
  tools.log.info(`Body: ${body}`);

  const result = await jira.addComment(issue, body);
  tools.log.complete("Comment added to Jira");
  return result;
}

async function addJiraTicket(jira, tools) {
  const payload = tools.context.payload;
  const title = payload.issue.title;
  const body = `${payload.issue.body}${mdPreamble}Original post: ${payload.issue.html_url} by ${payload.issue.user.html_url}`;

  const project = core.getInput('project', { required: true });

  tools.log.pending("Creating Jira ticket with the following parameters");
  tools.log.info(`Title: ${title}`);
  tools.log.info(`Body: ${body}`);
  tools.log.info(`Project: ${project}`);

  let request = {
    fields: {
      project: {
        key: project
      },
      summary: title,
      description: body,
      issuetype: {
        name: "Task"
      }
    }
  };

  const result = await jira.addNewIssue(request);
  tools.log.complete("Created Jira ticket");

  const jiraIssue = result.key;

  const ghIssueNumber = tools.context.issue.issue_number 
  tools.log.pending(`Creating issue comment ${ghIssueNumber} with Jira issue number ${jiraIssue}`);
  try {
    await tools.github.issues.createComment({
      owner: tools.context.repo.owner,
      repo: tools.context.repo.repo,
      issue_number: ghIssueNumber,
      body: `Issue: ${jiraIssue}`
    });
  } catch (error) {
    tools.log.fatal(error)
  }
  tools.log.complete("Successfully added new GitHub issue with Jira issue number");
  return result;
}