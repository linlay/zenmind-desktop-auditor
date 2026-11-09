import { randomUUID } from 'node:crypto';
import { COLORS,day,shiftDay } from '../frontend/core/contracts.mjs';
export function seed(now=Date.now()){
  const today=day(now),stamp=new Date(now).toISOString(),meta=()=>({id:randomUUID(),revision:1,createdAt:stamp,updatedAt:stamp});
  const members=[['林一','产品负责人'],['陈晨','前端工程师'],['周宁','后端工程师'],['许知','产品设计师'],['李沐','测试工程师'],['唐悦','运营经理']].map(([name,role],i)=>({...meta(),name,role,email:`member${i+1}@example.com`,capacity:40,color:COLORS[i]}));
  const specs=[['官网体验升级','重新梳理核心产品价值与试用路径，完成品牌与转化体验升级。',0,22,'active'],['移动端 2.0 发布','围绕核心使用场景升级移动体验，确保灰度发布质量。',1,12,'active'],['客户服务中心','建设统一的知识库、工单与客户反馈处理流程。',2,28,'active'],['品牌设计系统','统一设计规范与组件，沉淀跨产品的视觉和交互标准。',3,5,'active'],['数据分析看板','建立业务指标口径与可追溯的数据报表体系。',2,-2,'active'],['用户调研计划','完成访谈、洞察整理和优先级验证，为下季度规划提供依据。',5,-5,'completed']];
  const projects=specs.map(([name,description,owner,offset,status],i)=>({...meta(),code:`PRJ-${String(i+1).padStart(3,'0')}`,name,description,status,priority:i===1?'high':'medium',ownerId:members[owner].id,startDate:shiftDay(today,-24+i*2),dueDate:shiftDay(today,offset),budget:[48000,86000,32000,24000,36000,16000][i],color:COLORS[i]}));
  const titles=[['梳理首页信息架构','完成首屏视觉设计','开发项目案例模块','接入试用申请表单','优化移动端适配','完成发布前验收'],['冻结版本需求范围','完成核心页面开发','联调通知与消息模块','回归支付和登录流程','准备灰度发布方案','补充版本说明'],['整理常见问题目录','搭建工单分类体系','完成知识库搜索','接入满意度反馈','编写服务操作手册'],['定义基础色彩与字体','完善按钮与表单规范','建设组件文档站','验证无障碍对比度'],['确认核心业务指标','完成数据源联调','开发趋势图表','核对历史数据准确性','完成报表权限检查'],['制定访谈提纲','完成首轮用户访谈','汇总调研发现','提交洞察报告']];
  const tasks=[];let index=0;
  for(let p=0;p<projects.length;p++)for(let j=0;j<titles[p].length;j++){
    const done=p===5||j<Math.max(1,4-p),status=done?'done':j===titles[p].length-1?'todo':j%2?'in_progress':'review';
    const completion=shiftDay(today,-(index%13));
    tasks.push({...meta(),code:`TASK-${String(++index).padStart(3,'0')}`,title:titles[p][j],description:'明确验收标准，完成后记录交付结果。与项目负责人同步进展和阻塞事项。',projectId:projects[p].id,assigneeId:members[(p+j)%members.length].id,status,priority:j===3?'urgent':j%3===0?'high':'medium',dueDate:shiftDay(today,done?-8+j:p===4?-3+j:-2+j*3),estimate:8+j*4,spent:done?8+j*4:j*2,completedAt:done?completion+'T08:00:00.000Z':null});
  }
  return {version:1,revision:1,demo:true,projects,tasks,members,activity:[{id:randomUUID(),at:stamp,text:'示例工作空间已创建，可直接编辑或添加自己的项目。',kind:'system'}],analyses:[],comments:[],connection:{baseUrl:'http://127.0.0.1:11949',agentKey:''},sequence:{projects:6,tasks:index}};
}
