[StagingDefinition = [Kind = "FastCopy"]]
section Section1;
shared data_smarttime = let
    Source = Sql.Database("BIS-000-SP05.bis.xswhealth.nhs.uk, 14431", "Corporate_Data_Strategy"),
    #"select smarttime database" = Source{[Schema="dbo",Item="Smart_Time"]}[Data],
    #"filtered data before april24" = Table.SelectRows(#"select smarttime database", each [Timesheet_Start] >= #datetime(2024, 04, 1, 0, 0, 0)),
    #"changed date types" = Table.TransformColumnTypes(#"filtered data before april24",{{"Timesheet_Start", type date}, {"Timesheet_End", type date}, {"Timesheet_Closed_Date", type date}, {"Activity_Date", type date}, {"Work_Activity_Start", type date}, {"Work_Activity_End", type date}, {"Work_Activity_Retire_Date", type date}, {"Solution_Start_Date", type date}, {"Solution_End_Date", type date}, {"Contract_Start_Date", type date}, {"Contract_End_Date", type date}, {"Rate_Start_Date", type date}, {"Rate_End_Date", type date}, {"Contract_Id", type text}}),
    #"removed ""non review body""" = Table.ReplaceValue(#"changed date types","Non Review Body ","",Replacer.ReplaceText,{"Person_Payscale"}),
    #"removed ""review body""" = Table.ReplaceValue(#"removed ""non review body""","Review Body ","",Replacer.ReplaceText,{"Person_Payscale"}),
    #"created ""opp-cost"" custom column" = Table.AddColumn(#"removed ""review body""", "opp-cost", each Text.Combine({[Work_Activity_Pipeline_Code], [Person_CostCentre]}, "-"), type text),
    #"merge data from oracle agency cost rates" = Table.NestedJoin(#"created ""opp-cost"" custom column", {"Person_Payroll_Number"}, data_oracle_agency_cost_rates, {"Assignment_no"}, "data_oracle_agency_cost_rates", JoinKind.LeftOuter),
    #"expanded data" = Table.ExpandTableColumn(#"merge data from oracle agency cost rates", "data_oracle_agency_cost_rates", {"Hrly_rate"}, {"data_oracle_agency_cost_rates.Hrly_rate"}),
    #"renamed new column to ""agency rate""" = Table.RenameColumns(#"expanded data",{{"data_oracle_agency_cost_rates.Hrly_rate", "agency_rate"}}),
    #"merge data from oracle staff exceptions" = Table.NestedJoin(#"renamed new column to ""agency rate""", {"Person_Payroll_Number"}, data_oracle_staff_cost_exceptions, {"Assignment_no"}, "data_oracle_staff_cost_exceptions", JoinKind.LeftOuter),
    #"expanded data 2" = Table.ExpandTableColumn(#"merge data from oracle staff exceptions", "data_oracle_staff_cost_exceptions", {"Hrly_rate"}, {"data_oracle_staff_cost_exceptions.Hrly_rate"}),
    #"renamed new column to ""exception_rate""" = Table.RenameColumns(#"expanded data 2",{{"data_oracle_staff_cost_exceptions.Hrly_rate", "exception_rate"}}),
    #"removed "" - Range"" from Person_Payscale" = Table.ReplaceValue(#"renamed new column to ""exception_rate"""," - Range"," ",Replacer.ReplaceText,{"Person_Payscale"}),
    #"added brackets 1" = Table.ReplaceValue(#"removed "" - Range"" from Person_Payscale","A","(A)",Replacer.ReplaceText,{"Person_Payscale"}),
    #"added brackets 2" = Table.ReplaceValue(#"added brackets 1"," B"," (B)",Replacer.ReplaceText,{"Person_Payscale"}),
    #"added brackets 3" = Table.ReplaceValue(#"added brackets 2"," C"," (C)",Replacer.ReplaceText,{"Person_Payscale"}),
    #"added brackets 4" = Table.ReplaceValue(#"added brackets 3"," D"," (D)",Replacer.ReplaceText,{"Person_Payscale"}),
    #"changed cost_centre and personid to text" = Table.TransformColumnTypes(#"added brackets 4",{{"Person_CostCentre", type text}, {"Person_Id", type text}}),
    #"changed managerid to text" = Table.TransformColumnTypes(#"changed cost_centre and personid to text",{{"Manager_Id", type text}}),
    #"remove unnecessary columns" = Table.RemoveColumns(#"changed managerid to text",{"tmp_Id", "Timesheet_Token", "Activity_Is_Edit_History", "Activity_With_Person_Id", "Activity_With_Person_First_Name", "Activity_With_Person_Last_Name", "Work_Activity_Retire_Date", "Work_Activity_Filter_Code", "Work_Activity_Priority_Id", "Champion_Id", "Champion_First_Name", "Champion_Last_Name", "Solution_Id", "Solution_Name", "Solution_Lead_Id", "Solution_Lead_First_Name", "Solution_Lead_Last_Name", "Solution_Type_Id", "Solution_Value", "Solution_Start_Date", "Solution_End_Date", "Solution_funding_Stream", "Contract_Id", "Contract_Ref_No", "Contract_Owner_Id", "Contract_Owner_First_Name", "Contract_Owner_Last_Name", "Contract_Pipeline_Ref", "Contract_Value", "Contract_Consultancy_Value", "Contract_Contractual_Value", "Contract_Income_Category_Id", "Contract_Income_Category", "Contract_Contract_Type_Id", "Selected_Group_Id", "Selected_Group_Name_Common", "Selected_Group_Name_Full", "Rate_Table_Code", "Rate_Table_Description", "Rate_Start_Date", "Rate_End_Date", "Rate_Is_By_Band", "Is_Travel", "Derived_ID", "opp-cost", "agency_rate", "exception_rate"}),
  #"standardised cost centre l4 (1)" = Table.ReplaceValue(#"remove unnecessary columns", "Digital Analytics and Intelligence", "Digital Analytics And Intelligence", Replacer.ReplaceText, {"Person_Cost_Centre_Level_4"}),
  #"standardised cost centre l4 (2)" = Table.ReplaceValue(#"standardised cost centre l4 (1)", "Transformation (Excl BI)", "Transformation Excl BI", Replacer.ReplaceText, {"Person_Cost_Centre_Level_4"}),
  #"duplicated person_first_name" = Table.DuplicateColumn(#"standardised cost centre l4 (2)", "Person_FirstName", "Person_FirstName - Copy"),
  duplicated_person_lastname = Table.DuplicateColumn(#"duplicated person_first_name", "Person_LastName", "Person_LastName - Copy"),
  #"created combined column (capitalised first letter)" = Table.AddColumn(duplicated_person_lastname, "person_fullname_2", each [#"Person_FirstName - Copy"] & " " & [#"Person_LastName - Copy"]),
  #"convert person (first name, last name, email) to lowercase for consistency" = Table.TransformColumns(#"created combined column (capitalised first letter)", {{"Person_FirstName", each Text.Lower(_), type nullable text}, {"Person_LastName", each Text.Lower(_), type nullable text}, {"Person_Email", each Text.Lower(_), type nullable text}}),
  #"Renamed columns" = Table.RenameColumns(#"convert person (first name, last name, email) to lowercase for consistency", {{"Person_LastName - Copy", "Person_LastName2"}, {"Person_FirstName - Copy", "Person_FirstName2"}})
in
    #"Renamed columns";
shared data_oracle_agency_cost_rates = let
    Source = Sql.Database("BIS-000-SP05.bis.xswhealth.nhs.uk, 14431", "Corporate_Data_Strategy"),
    dbo_Oracle_Agency_cost_rates = Source{[Schema="dbo",Item="Oracle_Agency_cost_rates"]}[Data],
    #"Changed Type" = Table.TransformColumnTypes(dbo_Oracle_Agency_cost_rates,{{"Hrly_rate", type number}}),
    #"Replaced Value" = Table.ReplaceValue(#"Changed Type","44930","04/01/23",Replacer.ReplaceText,{"Effective_from"}),
    #"Changed Type1" = Table.TransformColumnTypes(#"Replaced Value",{{"Effective_from", type date}})
in
    #"Changed Type1";
shared data_oracle_staff_cost_exceptions = let
    Source = Sql.Database("BIS-000-SP05.bis.xswhealth.nhs.uk, 14431", "Corporate_Data_Strategy"),
    dbo_Oracle_Staff_Cost_Exceptions = Source{[Schema="dbo",Item="Oracle_Staff_Cost_Exceptions"]}[Data],
    #"Changed Type" = Table.TransformColumnTypes(dbo_Oracle_Staff_Cost_Exceptions,{{"Hrly_rate", type number}})
in
    #"Changed Type";
