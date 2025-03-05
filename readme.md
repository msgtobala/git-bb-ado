# git-bb-ado

git-bb-ado is a powerful command-line tool that automates the migration of repositories from Bitbucket to Azure DevOps. It supports migrating repositories with their complete commit history and provides validation to ensure successful transfers.

## Features

- **Migrate multiple repositories** from Bitbucket to Azure DevOps
- **Interactive prompts** for seamless user experience
- **Preserves commit history** during migration
- **Validation feature** to compare commit counts between Bitbucket and Azure DevOps
- **XLSX report generation** with migration/validation results and execution time
- **Progress indicators** for each repository
- **Error handling and retry logic**

## Installation

You can use the package via `npx` without installation:

```bash
npx git-bb-ado migrate
```

Or install it globally:

```bash
npm install -g git-bb-ado
```

## Usage

git-bb-ado provides two main commands: `migrate` and `validate`.

### **Migration**

To start migrating repositories from Bitbucket to Azure DevOps, run:

```bash
npx git-bb-ado migrate
```

#### **Steps**

1. Enter your Bitbucket workspace details.
2. Enter your Azure DevOps organization and project information.
3. Confirm the number of repositories to migrate.
4. Proceed with the migration.
5. Once completed, an XLSX report will be generated with status and execution time.

### **Validation**

To validate if all repositories were migrated successfully, run:

```bash
npx git-bb-ado validate
```

#### **Execution Steps**

1. Enter the same credentials used for migration.
2. The script will compare commit counts from Bitbucket and Azure DevOps.
3. An XLSX report will be generated with the validation results.

## Steps to Create a PAT Token for Azure DevOps

1. Go to [Azure DevOps](https://dev.azure.com/)
2. Click on your profile picture (top right corner)
3. Click on "Personal access tokens"
4. Click "New Token"
5. Select the necessary permissions (Code: Read & Write)
6. Generate the token and copy it

## Steps to Create an App Password for Bitbucket

1. Go to [Bitbucket](https://bitbucket.org/account/settings/)
2. Click on "App Passwords"
3. Create a new app password with repository read permissions
4. Generate and copy the password

## License

This project is licensed under the MIT License. See the LICENSE file for more details.
