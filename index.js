#!/usr/bin/env node

import { input, password } from '@inquirer/prompts';
import axios from 'axios';
import chalk from 'chalk';
import { createSpinner } from 'nanospinner';
import simpleGit from 'simple-git';
import { execSync } from 'child_process';
import * as XLSX from 'xlsx';

import { commands } from './config/commands.js';

async function getUserInputs(onlybitbucket) {
  let workspace = '',
    username = '',
    appPassword = '',
    azureOrg = '',
    azureProject = '',
    azurePat = '';
  workspace = await input({
    message: 'Enter your Bitbucket workspace:',
  });
  username = await input({
    message: 'Enter your Bitbucket username:',
  });
  appPassword = await password({
    message: 'Enter your Bitbucket app password:',
  });

  if (!onlybitbucket) {
    azureOrg = await input({
      message: 'Enter your Azure DevOps organization URL:',
    });
    azureProject = await input({
      message: 'Enter your Azure DevOps project name:',
    });
    azurePat = await password({
      message: 'Enter your Azure DevOps PAT:',
    });
  }

  return { workspace, username, appPassword, azureOrg, azureProject, azurePat };
}

async function fetchBitbucketReposByLoop({ workspace, username, appPassword }) {
  const spinner = createSpinner('Fetching Bitbucket repositories...').start();
  let allRepos = [];
  let url = `https://api.bitbucket.org/2.0/repositories/${workspace}`;

  try {
    while (url) {
      const response = await axios.get(url, {
        auth: { username, password: appPassword },
      });

      // Store repositories
      allRepos = allRepos.concat(response.data.values);

      // Check if there is another page
      url = response.data.next || null;
    }

    spinner.success({
      text: `Found ${allRepos.length} repositories.`,
    });

    return allRepos; // Returning full repository objects, not just slugs
  } catch (error) {
    console.error(
      chalk.red('Failed to fetch repositories:'),
      error.response?.data || error.message
    );
    spinner.error({ text: 'Failed to fetch repositories.' });
    process.exit(1);
  }
}

async function fetchBitbucketRepos({ workspace, username, appPassword }) {
  const spinner = createSpinner('Fetching Bitbucket repositories...').start();
  let allRepos = [];
  let url = `https://api.bitbucket.org/2.0/repositories/${workspace}`;

  try {
    do {
      const response = await axios.get(url, {
        auth: { username, password: appPassword },
      });

      allRepos.push(...response.data.values);

      url = response.data.next || null;
    } while (url);

    spinner.success({
      text: `Found ${allRepos.length} repositories.`,
    });

    return allRepos;
  } catch (error) {
    console.error(
      chalk.red('Failed to fetch repositories:'),
      error.response?.data || error.message
    );
    spinner.error({ text: 'Failed to fetch repositories.' });
    process.exit(1);
  }
}

async function migrateRepositories(credentials) {
  const repos = await fetchBitbucketRepos(credentials);
  console.log(chalk.blue(`Total repositories to migrate: ${repos.length}`));
  const proceed = await inquirer.confirm({
    message: 'Proceed with migration? (yes/no)',
  });
  if (!proceed) {
    console.log(chalk.yellow('Migration aborted by user.'));
    process.exit(0);
  }

  let passed = 0,
    failed = 0;
  let report = [];

  for (const repo of repos) {
    console.log(chalk.blue(`\nMigrating repository: ${repo}...`));
    const startTime = Date.now();
    try {
      const git = simpleGit();
      await git.clone(
        `https://${credentials.username}:${credentials.appPassword}@bitbucket.org/${credentials.workspace}/${repo}.git`,
        `${repo}.git`,
        ['--mirror']
      );
      console.log(chalk.green(`✔ Cloned ${repo} successfully.`));

      await axios.post(
        `${credentials.azureOrg}/${credentials.azureProject}/_apis/git/repositories?api-version=6.0`,
        { name: repo },
        {
          headers: {
            Authorization: `Basic ${Buffer.from(
              `:${credentials.azurePat}`
            ).toString('base64')}`,
          },
        }
      );
      console.log(chalk.green(`✔ Created repository in Azure DevOps.`));

      process.chdir(`${repo}.git`);
      await git.addRemote(
        'azure',
        `${credentials.azureOrg}/${credentials.azureProject}/_git/${repo}`
      );
      await git.push(['--mirror', 'azure']);
      process.chdir('..');
      execSync(`rm -rf ${repo}.git`);
      console.log(chalk.green(`✔ Migration completed for ${repo}`));

      passed++;
      report.push({
        Repository: repo,
        Status: 'Success',
        TimeTaken: `${(Date.now() - startTime) / 1000}s`,
      });
    } catch (error) {
      console.error(chalk.red(`❌ Error migrating ${repo}: ${error.message}`));
      failed++;
      report.push({ Repository: repo, Status: 'Failed', TimeTaken: 'N/A' });
    }
  }

  console.log(
    chalk.green(`\nMigration Summary: ${passed} Passed, ${failed} Failed`)
  );
  const ws = XLSX.utils.json_to_sheet(report);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Migration Report');
  XLSX.writeFile(wb, 'migration_report.xlsx');
}

async function validateRepositories(credentials) {
  const repos = await fetchBitbucketRepos(credentials);
  let report = [];

  for (const repo of repos) {
    console.log(chalk.blue(`\nValidating repository: ${repo}...`));
    try {
      const git = simpleGit();
      await git.clone(
        `https://${credentials.username}:${credentials.appPassword}@bitbucket.org/${credentials.workspace}/${repo}.git`,
        `bitbucket_${repo}.git`,
        ['--mirror']
      );
      const bitbucketCommits = execSync(
        `cd bitbucket_${repo}.git && git rev-list --all --count`
      )
        .toString()
        .trim();
      execSync(`rm -rf bitbucket_${repo}.git`);

      await git.clone(
        `${credentials.azureOrg}/${credentials.azureProject}/_git/${repo}`,
        `azure_${repo}.git`,
        ['--mirror']
      );
      const azureCommits = execSync(
        `cd azure_${repo}.git && git rev-list --all --count`
      )
        .toString()
        .trim();
      execSync(`rm -rf azure_${repo}.git`);

      if (bitbucketCommits === azureCommits) {
        console.log(chalk.green(`✔ Validation successful for ${repo}`));
        report.push({ Repository: repo, Status: 'Success' });
      } else {
        console.error(chalk.red(`❌ Validation failed for ${repo}`));
        report.push({ Repository: repo, Status: 'Failed' });
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error validating ${repo}: ${error.message}`));
      report.push({ Repository: repo, Status: 'Failed' });
    }
  }

  const ws = XLSX.utils.json_to_sheet(report);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Validation Report');
  XLSX.writeFile(wb, 'validation_report.xlsx');
}

async function fetchRepoDetails(repo, { workspace, username, appPassword }) {
  try {
    const membersResponse = await axios.get(
      `https://api.bitbucket.org/2.0/workspaces/${workspace}/permissions/repositories/${repo.slug}`,
      { auth: { username, password: appPassword } }
    );
    const members = membersResponse.data.values.map(
      (member) => `${member.user.display_name} (${member.permission})`
    );

    let hasPipeline = 'No';
    try {
      const response = await axios.get(
        `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo.slug}/pipelines/`,
        { auth: { username, password: appPassword } }
      );
      console.log(response.data.values.length);
      if (response.data.values.length) {
        hasPipeline = 'Yes';
      }
    } catch (pipelineError) {
      hasPipeline = 'No';
    }

    return {
      Repository: repo.slug,
      Members: members.join(', '),
      Pipeline: hasPipeline,
    };
  } catch (error) {
    console.error(
      chalk.red(`❌ Error fetching details for ${repo.slug}: ${error.message}`)
    );
    return {
      Repository: repo.slug,
      Members: 'Error fetching members',
      Pipeline: 'Error',
    };
  }
}

async function analyzeBitbucketRepo(credentials) {
  const repos = await fetchBitbucketRepos(credentials);
  let report = [];

  const spinner = createSpinner('Analyzing repositories...').start();
  for (const repo of repos) {
    const repoDetails = await fetchRepoDetails(repo, credentials);
    report.push(repoDetails);
  }
  spinner.success({ text: 'Analysis completed!' });

  const ws = XLSX.utils.json_to_sheet(report);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bitbucket Analysis');
  XLSX.writeFile(wb, 'bitbucket_analysis.xlsx');

  console.log(
    chalk.green('\n✔ Analysis report saved as bitbucket_analysis.xlsx')
  );
}

async function fetchBitbucketProjects({ workspace, username, appPassword }) {
  try {
    let allProjects = [];
    let url = `https://api.bitbucket.org/2.0/workspaces/${workspace}/projects`;

    while (url) {
      const response = await axios.get(url, {
        auth: { username, password: appPassword },
      });

      allProjects = allProjects.concat(response.data.values);
      url = response.data.next || null;
    }

    return allProjects;
  } catch (error) {
    console.error(chalk.red('❌ Failed to fetch projects:', error.message));
    return [];
  }
}

async function fetchRepoCountForProject(
  project,
  { workspace, username, appPassword }
) {
  try {
    let repoCount = 0;
    let url = `https://api.bitbucket.org/2.0/repositories/${workspace}?q=project.key="${project.key}"`;

    while (url) {
      const response = await axios.get(url, {
        auth: { username, password: appPassword },
      });

      if(repoCount === 0) {
        console.log(response.data);
      }

      repoCount += response.data.values.length;
      url = response.data.next || null;
    }

    return repoCount;
  } catch (error) {
    console.error(
      chalk.red(
        `❌ Error fetching repos for project ${project.key}: ${error.message}`
      )
    );
    return 0;
  }
}

async function analyzeBitbucketProject(credentials) {
  console.log(chalk.blue('🔍 Analyzing Bitbucket projects...'));

  const projects = await fetchBitbucketProjects(credentials);
  if (projects.length === 0) {
    console.log(chalk.yellow('🚨 No projects found in the workspace.'));
    return;
  }

  const spinner = createSpinner('Fetching repository counts...').start();
  let report = [];

  for (const project of projects) {
    const repoCount = await fetchRepoCountForProject(project, credentials);

    report.push({
      ProjectName: project.name,
      ProjectCode: project.key,
      RepoCount: repoCount,
    });
  }

  spinner.success({ text: '✔ Project analysis completed!' });

  const ws = XLSX.utils.json_to_sheet(report);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bitbucket Projects Analysis');
  XLSX.writeFile(wb, 'bitbucket_projects_analysis.xlsx');

  console.log(
    chalk.green('\n✔ Analysis report saved as bitbucket_projects_analysis.xlsx')
  );
}

async function main() {
  const command = process.argv[2];
  if (!command || !commands.includes(command)) {
    console.log(
      chalk.red(
        'Usage: npx <package-name> migrate | validate | analyze:repo' |
          'analyze:project'
      )
    );
    process.exit(1);
  }

  if (command === 'migrate') {
    const credentials = await getUserInputs();
    await migrateRepositories(credentials);
  } else if (command === 'validate') {
    const credentials = await getUserInputs();
    await validateRepositories(credentials);
  } else if (command === 'analyze:repo') {
    const credentials = await getUserInputs(true);
    await analyzeBitbucketRepo(credentials);
  } else if (command === 'analyze:project') {
    const credentials = await getUserInputs(true);
    await analyzeBitbucketProject(credentials);
  }
}

main();
