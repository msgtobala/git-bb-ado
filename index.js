#!/usr/bin/env node

import { input, password } from '@inquirer/prompts';
import axios from 'axios';
import chalk from 'chalk';
import { createSpinner } from 'nanospinner';
import simpleGit from 'simple-git';
import { execSync } from 'child_process';
import * as XLSX from 'xlsx';
import fs from 'fs';

async function getUserInputs() {
  const workspace = await input({
    message: 'Enter your Bitbucket workspace:',
  });
  const username = await input({
    message: 'Enter your Bitbucket username:',
  });
  const appPassword = await password({
    message: 'Enter your Bitbucket app password:',
  });
  const azureOrg = await input({
    message: 'Enter your Azure DevOps organization URL:',
  });
  const azureProject = await input({
    message: 'Enter your Azure DevOps project name:',
  });
  const azurePat = await password({
    message: 'Enter your Azure DevOps PAT:',
  });

  return { workspace, username, appPassword, azureOrg, azureProject, azurePat };
}

async function fetchBitbucketRepos({ workspace, username, appPassword }) {
  const spinner = createSpinner('Fetching Bitbucket repositories...').start();
  try {
    const response = await axios.get(
      `https://api.bitbucket.org/2.0/repositories/${workspace}?pagelen=100`,
      { auth: { username, password: appPassword } }
    );
    spinner.success({
      text: `Found ${response.data.values.length} repositories.`,
    });
    return response.data.values.map((repo) => repo.slug);
  } catch (error) {
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

async function main() {
  const command = process.argv[2];
  if (!command || (command !== 'migrate' && command !== 'validate')) {
    console.log(chalk.red('Usage: npx <package-name> migrate | validate'));
    process.exit(1);
  }

  const credentials = await getUserInputs();
  if (command === 'migrate') {
    await migrateRepositories(credentials);
  } else if (command === 'validate') {
    await validateRepositories(credentials);
  }
}

main();
