import { context, GitHub } from '@actions/github/lib/github';
import Octokit from '@octokit/rest';
import { getInputs } from './action-inputs';
import { ESource, IGithubData, JIRADetails, PullRequestParams } from './types';
import { getJIRAIssueKeyByDefaultRegexp, getJIRAIssueKeysByCustomRegexp } from './utils';

export class GithubConnector {
  client: GitHub = {} as GitHub;
  githubData: IGithubData = {} as IGithubData;
  octokit: Octokit;
  toGithubLabel: (string: string) => string;

  constructor() {
    const { GITHUB_TOKEN, STATUSES } = getInputs();
    this.client = new GitHub(GITHUB_TOKEN);
    this.octokit = new Octokit({ auth: GITHUB_TOKEN });

    this.toGithubLabel = (jiraLabel: string) => {
      console.info('labels loaded from action workflow setup:', STATUSES);
      if (STATUSES[jiraLabel]) {
        console.info(`Using label mapping for ${jiraLabel} -> ${STATUSES[jiraLabel]}, from action config`);
        return STATUSES[jiraLabel];
      }

      console.info(`Label ${jiraLabel} not found in mapping`);
      return '';
    };

    this.githubData = this.getGithubData();
  }

  get isPRAction(): boolean {
    return this.githubData.eventName === 'pull_request' || this.githubData.eventName === 'pull_request_target';
  }

  get headBranch(): string {
    return this.githubData.pullRequest.head.ref;
  }

  getIssueKeyFromTitle(): string {
    const { WHAT_TO_USE } = getInputs();

    const prTitle = this.githubData.pullRequest.title || '';
    const branchName = this.headBranch;

    let keyFound: string | null = null;

    switch (WHAT_TO_USE) {
      case ESource.branch:
        keyFound = this.getIssueKeyFromString(branchName);
        break;
      case ESource.prTitle:
        keyFound = this.getIssueKeyFromString(prTitle);
        break;
      case ESource.both:
        keyFound = this.getIssueKeyFromString(prTitle) || this.getIssueKeyFromString(branchName);
        break;
    }

    if (!keyFound) {
      throw new Error(' JIRA key not found ');
    }
    console.log(`JIRA key found -> ${keyFound}`);
    return keyFound;
  }

  private getIssueKeyFromString(stringToParse: string): string | null {
    const { JIRA_PROJECT_KEY, CUSTOM_ISSUE_NUMBER_REGEXP } = getInputs();
    const shouldUseCustomRegexp = !!CUSTOM_ISSUE_NUMBER_REGEXP;

    console.log(`looking in: ${stringToParse}`);

    return shouldUseCustomRegexp
      ? getJIRAIssueKeysByCustomRegexp(stringToParse, CUSTOM_ISSUE_NUMBER_REGEXP, JIRA_PROJECT_KEY)
      : getJIRAIssueKeyByDefaultRegexp(stringToParse);
  }

  async updatePrDetails(details: JIRADetails) {
    const owner = this.githubData.owner;
    const repo = this.githubData.repository.name;
    console.log('Updating PR statuses');
    const { number: prNumber = 0 } = this.githubData.pullRequest;

    const labels = [this.toGithubLabel(details.status.name)];

    if (labels.length === 0) {
      console.info('No labels to add');
      return;
    }

    try {
      await this.client.issues.addLabels({
        owner,
        repo,
        issue_number: prNumber,
        labels,
      });
    } catch (error) {
      console.error(`Failed to add statuses. Check that all ${labels.join(', ')} statuses exists on github.`);
      throw error;
    }
  }

  // PR description may have been updated by some other action in the same job, need to re-fetch it to get the latest
  async getLatestPRDescription({ owner, repo, number }: { owner: string; repo: string; number: number }): Promise<string> {
    return this.octokit.pulls
      .get({
        owner,
        repo,
        pull_number: number,
      })
      .then(({ data }: { data: PullRequestParams }) => {
        return data.body || '';
      });
  }

  private getGithubData(): IGithubData {
    const {
      eventName,
      payload: {
        repository,
        organization: { login: owner },
        pull_request: pullRequest,
      },
    } = context;

    return {
      eventName,
      repository,
      owner,
      pullRequest: pullRequest as PullRequestParams,
    };
  }
}
