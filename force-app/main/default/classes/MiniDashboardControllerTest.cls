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
        insert cases;

        Test.startTest();
        MiniDashboardController.DashboardData data = MiniDashboardController.getDashboardData(acc.Id);
        Test.stopTest();

        System.assertEquals(2, data.totals.get('New').count);
        System.assertEquals(1, data.totals.get('Open').count, 'Working should count as Open');
        System.assertEquals(1, data.accountSpecific.get('New').count);
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
        // Reverted signature: (String dashboardId, Id accountId, List<String> fields, String sortField, String sortOrder, String searchTerm, Integer offset, String advancedField, String advancedValue, Boolean onlyMine, Integer limitCount, String priorityFilter)
        List<Case> smart = MiniDashboardController.getCaseList('New', acc.Id, new List<String>{'Subject'}, 'Subject', 'ASC', null, 0, 'Priority', 'High', false, 20, null);
        System.assertEquals(1, smart.size());

        List<Case> search = MiniDashboardController.getCaseList('New', null, new List<String>{'Subject'}, 'Subject', 'DESC', 'Specific', 0, null, null, false, 20, null);
        System.assertEquals(1, search.size());

        List<Case> empty = MiniDashboardController.getCaseList('Invalid', null, null, null, null, null, 0, null, null, false, 20, null);
        System.assertEquals(0, empty.size());
        
        try {
            MiniDashboardController.getCaseList('New', null, new List<String>{'Subject'}, 'Subject; DELETE FROM Case', 'ASC', null, 0, null, null, false, 20, null);
        } catch (Exception e) {}
        Test.stopTest();
    }
}