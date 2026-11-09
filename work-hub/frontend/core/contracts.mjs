export const PROJECT_STATUS = { planned:'未开始',active:'进行中',paused:'已暂停',completed:'已完成' };
export const TASK_STATUS = { todo:'待处理',in_progress:'进行中',review:'待验收',done:'已完成' };
export const PRIORITY = { low:'低',medium:'中',high:'高',urgent:'紧急' };
export const COLORS = ['#458579','#6488bb','#9a7bb9','#cb9454','#bd7482','#7d995f'];
export const problem = (code,message,status=400) => Object.assign(new Error(message),{code,status});
export function day(now=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
export function shiftDay(value,offset){return new Date(Date.parse(value+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);}
export function validateEntity(kind,input,data,current){
  if(!input||typeof input!=='object'||Array.isArray(input))throw problem('invalid_record','请填写有效的数据。');
  const allowed={projects:['name','description','status','priority','ownerId','startDate','dueDate','budget','color'],tasks:['title','description','projectId','assigneeId','status','priority','dueDate','estimate','spent'],members:['name','email','role','capacity','color']}[kind];
  if(!allowed||Object.keys(input).some(key=>!allowed.includes(key)))throw problem('unknown_field','包含未支持的字段。');
  const text=(key,max,required=false)=>{const value=input[key]??'';if(typeof value!=='string'||value.length>max||required&&!value.trim())throw problem('invalid_record',`${key} 格式错误或超出长度限制。`);return value.trim();};
  const number=(key,max)=>{const value=input[key]??0;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max)throw problem('invalid_record',`${key} 需要是 0–${max} 之间的数字。`);return Math.round(value*100)/100;};
  const date=key=>{const value=text(key,10);if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00Z'))||new Date(value+'T12:00Z').toISOString().slice(0,10)!==value))throw problem('invalid_record','日期格式不正确。');return value;};
  const member=key=>{const id=text(key,80);if(id&&!data.members.some(row=>row.id===id))throw problem('member_not_found','所选成员已不存在，请刷新。',409);return id;};
  const color=()=>{const value=input.color||COLORS[0];if(!COLORS.includes(value))throw problem('invalid_record','请选择有效颜色。');return value;};
  if(kind==='members'){
    const email=text('email',160);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw problem('invalid_record','请填写有效邮箱。');
    if(email&&data.members.some(row=>row.id!==current?.id&&row.email.toLowerCase()===email.toLowerCase()))throw problem('email_exists','该邮箱已用于其他成员。',409);
    return {name:text('name',60,true),email,role:text('role',80),capacity:number('capacity',168),color:color()};
  }
  const status=input.status||(kind==='projects'?'planned':'todo'),priority=input.priority||'medium';
  if(!Object.hasOwn(kind==='projects'?PROJECT_STATUS:TASK_STATUS,status)||!Object.hasOwn(PRIORITY,priority))throw problem('invalid_record','状态或优先级不正确。');
  if(kind==='projects'){
    const startDate=date('startDate'),dueDate=date('dueDate');if(startDate&&dueDate&&startDate>dueDate)throw problem('invalid_record','截止日期不能早于开始日期。');
    if(status==='completed'&&data.tasks.some(task=>task.projectId===current?.id&&task.status!=='done'))throw problem('open_tasks','仍有未完成任务，请先处理后再完成项目。',409);
    return {name:text('name',100,true),description:text('description',10000),status,priority,ownerId:member('ownerId'),startDate,dueDate,budget:number('budget',1e9),color:color()};
  }
  const projectId=text('projectId',80,true),project=data.projects.find(row=>row.id===projectId);if(!project)throw problem('project_not_found','请选择已有项目。',409);
  if(project.status==='completed'&&status!=='done')throw problem('project_completed','已完成项目不能添加未完成任务，请先恢复项目。',409);
  return {title:text('title',180,true),description:text('description',12000),projectId,assigneeId:member('assigneeId'),status,priority,dueDate:date('dueDate'),estimate:number('estimate',10000),spent:number('spent',10000)};
}
export function projectMetrics(project,tasks,today=day()){
  const rows=tasks.filter(task=>task.projectId===project.id),done=rows.filter(task=>task.status==='done').length,overdue=rows.filter(task=>task.status!=='done'&&task.dueDate&&task.dueDate<today).length;
  return {taskCount:rows.length,completedTasks:done,progress:rows.length?Math.round(done/rows.length*100):project.status==='completed'?100:0,overdueTasks:overdue,estimate:rows.reduce((n,t)=>n+t.estimate,0),spent:rows.reduce((n,t)=>n+t.spent,0),risk:overdue>0||project.status!=='completed'&&project.dueDate&&project.dueDate<today?'high':rows.some(t=>t.status!=='done'&&t.priority==='urgent')?'medium':'low'};
}
