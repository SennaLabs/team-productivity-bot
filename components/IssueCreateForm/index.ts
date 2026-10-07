"use client";

import { IssueCreateForm } from "./IssueCreateForm";
import { withIssueCreateForm } from "./withIssueCreateForm";

const ConnectedIssueCreateForm = withIssueCreateForm(IssueCreateForm);

export { ConnectedIssueCreateForm as IssueCreateForm };
