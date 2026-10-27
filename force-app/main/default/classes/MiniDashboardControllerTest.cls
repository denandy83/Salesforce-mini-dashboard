@IsTest
public class MiniDashboardControllerTest {
    @IsTest
    static void testGetDashboardData() {
        Account acc = new Account(Name = 'Test Account');
        insert acc;
        
        List<Case> cases = new List<Case>();
        cases.add(new Case(Status = 'New', Subject = 'Global New', Priority = 'Urgent'));
        cases.add(new Case(Status = 'Working', Subject = 'Global Working', Priority = 'High')); 
        cases.add(new Case(Status = 'New', Subject = 'Account New', AccountId = acc.Id, Priority = 'Normal'));
        cases.add(new Case(Status = 'Solved', Subject = 'Global Solved', Priority = 'Low'));
        insert cases;

        Test.startTest();
        MiniDashboardController.DashboardData data = MiniDashboardController.getDashboardData(acc.Id, null, null);
        Test.stopTest();

        System.assertEquals(2, data.totals.get('New').count);
        System.assertEquals(1, data.totals.get('Open').count, 'Working should count as Open');
        System.assertEquals(1, data.accountSpecific.get('New').count);
        System.assertEquals(1, data.totals.get('Solved').count);
        System.assertNotEquals(null, data.myTickets);
        System.assert(data.totals.get('New').priorityTooltip.contains('U: 1'), 'Tooltip should contain Urgent count');
    }

    @IsTest
    static void testGetCaseListAdvanced() {
        Account acc = new Account(Name = 'Test Account');
        insert acc;
        Case c = new Case(Status = 'New', Subject = 'Specific Subject', Priority = 'High', AccountId = acc.Id);
        insert c;

        Test.startTest();
        // Signature: (String dashboardId, Id accountId, List<String> fields, String sortField, String sortOrder, String searchTerm, Integer offset, String advancedField, String advancedValue, Boolean onlyMine, Integer limitCount, List<String> priorityFilter, Boolean hasJira, List<String> statusFilter, List<String> unresponsiveFilter, List<String> regionNames, List<String> jiraKeyTypes, List<String> recordTypes)
        List<Case> smart = MiniDashboardController.getCaseList('New', acc.Id, new List<String>{'Subject'}, 'Subject', 'ASC', null, 0, 'Priority', 'High', false, 20, new List<String>{'High'}, false, null, null, null, null, null);
        System.assertEquals(1, smart.size());

        List<Case> search = MiniDashboardController.getCaseList('New', null, new List<String>{'Subject'}, 'Subject', 'DESC', 'Specific', 0, null, null, false, 20, null, false, null, null, null, null, null);
        System.assertEquals(1, search.size());

        List<Case> empty = MiniDashboardController.getCaseList('Invalid', null, null, null, null, null, 0, null, null, false, 20, null, false, null, null, null, null, null);
        System.assertEquals(0, empty.size());

        List<Case> multiStatus = MiniDashboardController.getCaseList('ALL', null, new List<String>{'Subject'}, null, null, null, 0, null, null, false, 20, null, false, new List<String>{'New', 'Open'}, null, null, null, null);
        System.assertEquals(1, multiStatus.size());

        // Jira key type filter - cases without matching Jira tickets should be excluded
        List<Case> intFiltered = MiniDashboardController.getCaseList('New', null, new List<String>{'Subject'}, null, null, null, 0, null, null, false, 20, null, false, null, null, null, new List<String>{'INT'}, null);
        System.assertEquals(0, intFiltered.size(), 'No AVIOINT Jira tickets exist in this test context');

        try {
            MiniDashboardController.getCaseList('New', null, new List<String>{'Subject'}, 'Subject; DELETE FROM Case', 'ASC', null, 0, null, null, false, 20, null, false, null, null, null, null, null);
        } catch (Exception e) {}
        Test.stopTest();
    }

    private static Id rtId(String devName) {
        return Schema.SObjectType.Case.getRecordTypeInfosByDeveloperName().get(devName).getRecordTypeId();
    }

    @IsTest
    static void testRecordTypeFilter() {
        List<Case> cases = new List<Case>();
        cases.add(new Case(Status = 'Open', Subject = 'rt-data', Priority = 'High', RecordTypeId = rtId('AVB_AvioData_Case')));
        cases.add(new Case(Status = 'New', Subject = 'rt-book', Priority = 'Normal', RecordTypeId = rtId('AVB_AvioBook_Case')));
        cases.add(new Case(Status = 'New', Subject = 'rt-prob', Priority = 'Low', RecordTypeId = rtId('AVB_Problem_Case')));
        insert cases;

        Test.startTest();
        MiniDashboardController.DashboardData all = MiniDashboardController.getDashboardData(null, null, null);
        MiniDashboardController.DashboardData avioData = MiniDashboardController.getDashboardData(null, null, new List<String>{'AVB_AvioData_Case'});
        MiniDashboardController.DashboardData unknown = MiniDashboardController.getDashboardData(null, null, new List<String>{'No_Such_Type'});
        List<Case> problems = MiniDashboardController.getCaseList('ALL', null, new List<String>{'Subject'}, null, null, null, 0, null, null, false, 20, null, false, null, null, null, null, new List<String>{'AVB_Problem_Case'});
        Test.stopTest();

        System.assertEquals(3, all.totals.get('ALL').count, 'No record type selected should count every case');
        System.assertEquals(1, avioData.totals.get('ALL').count);
        System.assertEquals(1, avioData.totals.get('Open').count);
        System.assertEquals(0, avioData.totals.get('New').count);
        System.assertEquals(0, unknown.totals.get('ALL').count, 'Unknown record type should match nothing');
        System.assertEquals(1, problems.size());
        System.assertEquals('rt-prob', problems[0].Subject);
    }
}