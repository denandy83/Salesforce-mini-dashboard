public with sharing class MiniDashboardController {
    
    public class StatusSummary {
        @AuraEnabled public Integer count = 0;
        @AuraEnabled public String priorityTooltip = 'U: 0 | H: 0 | N: 0 | L: 0';
        @AuraEnabled public Map<String, Integer> priorityMap = new Map<String, Integer>{
            'Urgent' => 0, 'High' => 0, 'Normal' => 0, 'Low' => 0
        };
    }

    public class DashboardData {
        @AuraEnabled public Map<String, StatusSummary> totals;
        @AuraEnabled public Map<String, StatusSummary> accountSpecific;
        @AuraEnabled public Map<String, StatusSummary> myTickets;
    }

    private static Map<String, List<String>> statusMap = new Map<String, List<String>>{
        'New' => new List<String>{'New'},
        'Open' => new List<String>{'Open', 'Working'},
        'Waiting for Customer' => new List<String>{'Waiting for Customer'},
        'On Hold' => new List<String>{'On Hold'},
        'Solved' => new List<String>{'Solved'},
        'ALL' => new List<String>{'New', 'Open', 'Working', 'Waiting for Customer', 'On Hold', 'Solved'}
    };

    @AuraEnabled
    public static DashboardData getDashboardData(Id accountId) {
        DashboardData data = new DashboardData();
        data.totals = getSummaries(null, false);
        data.myTickets = getSummaries(null, true);
        data.accountSpecific = (accountId != null) ? getSummaries(accountId, false) : null;
        return data;
    }

    private static Map<String, StatusSummary> getSummaries(Id accountId, Boolean onlyMine) {
        Map<String, StatusSummary> results = new Map<String, StatusSummary>{
            'New' => new StatusSummary(), 
            'Open' => new StatusSummary(), 
            'Waiting for Customer' => new StatusSummary(), 
            'On Hold' => new StatusSummary(),
            'Solved' => new StatusSummary(),
            'ALL' => new StatusSummary()
        };

        String query = 'SELECT Status, Priority, COUNT(Id) cnt FROM Case WHERE Status IN (\'New\', \'Open\', \'Working\', \'Waiting for Customer\', \'On Hold\', \'Solved\')';
        
        if (accountId != null) query += ' AND AccountId = :accountId';
        if (onlyMine) {
            Id currentUserId = UserInfo.getUserId();
            query += ' AND OwnerId = :currentUserId';
        }

        query += ' GROUP BY Status, Priority';

        for (AggregateResult ar : Database.query(query, AccessLevel.USER_MODE)) {
            String status = (String)ar.get('Status');
            String priority = (String)ar.get('Priority');
            Integer count = (Integer)ar.get('cnt');
            
            for (String dashboardId : statusMap.keySet()) {
                if (statusMap.get(dashboardId).contains(status)) {
                    StatusSummary summary = results.get(dashboardId);
                    summary.count += count;
                    if (summary.priorityMap.containsKey(priority)) {
                        summary.priorityMap.put(priority, summary.priorityMap.get(priority) + count);
                    }
                }
            }
        }

        for (StatusSummary summary : results.values()) {
            summary.priorityTooltip = 'U: ' + summary.priorityMap.get('Urgent') + 
                                     ' | H: ' + summary.priorityMap.get('High') + 
                                     ' | N: ' + summary.priorityMap.get('Normal') + 
                                     ' | L: ' + summary.priorityMap.get('Low');
        }

        return results;
    }

    @AuraEnabled
    public static List<Case> getCaseList(String dashboardId, Id accountId, List<String> fields, String sortField, String sortOrder, String searchTerm, Integer offset, String advancedField, String advancedValue, Boolean onlyMine, Integer limitCount, List<String> priorityFilter, Boolean hasJira, List<String> statusFilter) {
        List<String> statuses = (statusFilter != null && !statusFilter.isEmpty()) ? statusFilter : statusMap.get(dashboardId);
        if (statuses == null) return new List<Case>();

        Set<String> fieldSet = new Set<String>{'Id', 'CaseNumber'};
        Boolean includeJira = false;
        if (fields != null) {
            for (String f : fields) { 
                if (String.isNotBlank(f)) {
                    String rawF = f.trim().split(':')[0].trim();
                    String cleanF = rawF.replaceAll('[^a-zA-Z0-9._]', '');
                    if (cleanF.equalsIgnoreCase('Jira')) {
                        includeJira = true;
                    } else {
                        fieldSet.add(cleanF); 
                    }
                }
            }
        }
        
        List<String> fieldList = new List<String>(fieldSet);
        if (includeJira) {
            fieldList.add('(SELECT Name FROM Jira_Tickets__r)');
        }
        
        String fieldString = String.join(fieldList, ', ');
        String query = 'SELECT ' + fieldString + ' FROM Case WHERE Status IN :statuses';
        
        if (accountId != null) query += ' AND AccountId = :accountId';
        if (onlyMine == true) {
            Id currentUserId = UserInfo.getUserId();
            query += ' AND OwnerId = :currentUserId';
        }

        if (priorityFilter != null && !priorityFilter.isEmpty()) {
            query += ' AND Priority IN :priorityFilter';
        }

        if (hasJira == true) {
            query += ' AND Id IN (SELECT AVB_Case__c FROM AVB_Jira_Ticket__c)';
        }

        if (String.isNotBlank(advancedField) && String.isNotBlank(advancedValue)) {
            String sanitizedField = advancedField.replaceAll('[^a-zA-Z0-9._]', '');
            String escapedValue = '%' + String.escapeSingleQuotes(advancedValue.trim()) + '%';
            query += ' AND ' + sanitizedField + ' LIKE :escapedValue';
        } else if (String.isNotBlank(searchTerm)) {
            String escapedSearch = '%' + String.escapeSingleQuotes(searchTerm) + '%';
            List<String> searchFilters = new List<String>();
            for (String f : fieldSet) {
                String fieldLower = f.toLowerCase();
                if (!fieldLower.equals('id') && !fieldLower.endsWith('id') && !fieldLower.contains('date') && !fieldLower.equals('isclosed') && !fieldLower.equals('isdeleted')) {
                    searchFilters.add(f + ' LIKE :escapedSearch');
                }
            }
            if (!searchFilters.isEmpty()) {
                query += ' AND (' + String.join(searchFilters, ' OR ') + ')';
            }
        }
        
        if (String.isNotBlank(sortField)) {
            String sanitizedSort = sortField.replaceAll('[^a-zA-Z0-9._]', '');
            String direction = (String.isNotBlank(sortOrder) && sortOrder.toLowerCase() == 'asc' ? 'ASC' : 'DESC');
            String nullsOrder = (direction == 'ASC' ? 'NULLS FIRST' : 'NULLS LAST');
            query += ' ORDER BY ' + sanitizedSort + ' ' + direction + ' ' + nullsOrder;
        } else {
            query += ' ORDER BY CreatedDate DESC';
        }
        
        Integer finalLimit = (limitCount != null && limitCount > 0) ? limitCount : 20;
        query += ' LIMIT ' + finalLimit + ' OFFSET ' + (offset != null ? offset : 0);
        return Database.query(query, AccessLevel.USER_MODE);
    }
}